import type { RunSummary } from "./run.ts";

const RAMP_LOOKBACK_WEEKS = 3;

export interface WeekSummary {
  weekStart: string; // Monday, YYYY-MM-DD
  runs: number;
  miles: number;
  longestMiles: number;
  load: number;
  easyPct: number | null;
  /** Miles vs the average of up to 3 prior weeks. >0.10 is ramping faster than the ~10% guideline. */
  rampPct: number | null;
}

/** Monday of the week containing a local YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One summary per week from `firstWeek` through `lastWeek`, including weeks with no runs. */
export function summarizeWeeks(runs: RunSummary[], firstWeek: string, lastWeek: string): WeekSummary[] {
  const weeks: WeekSummary[] = [];
  for (let w = firstWeek; w <= lastWeek; w = addDays(w, 7)) {
    const inWeek = runs.filter((r) => weekStart(r.date) === w);
    const miles = inWeek.reduce((sum, r) => sum + r.miles, 0);
    const withZones = inWeek.filter((r) => r.easyPct !== null);
    const zoneSec = withZones.reduce((sum, r) => sum + r.movingSec, 0);
    const prior = weeks.slice(-RAMP_LOOKBACK_WEEKS);
    const priorAvg = prior.length ? prior.reduce((sum, p) => sum + p.miles, 0) / prior.length : 0;
    weeks.push({
      weekStart: w,
      runs: inWeek.length,
      miles,
      longestMiles: Math.max(0, ...inWeek.map((r) => r.miles)),
      load: inWeek.reduce((sum, r) => sum + (r.load ?? 0), 0),
      easyPct: zoneSec
        ? withZones.reduce((sum, r) => sum + r.easyPct! * r.movingSec, 0) / zoneSec
        : null,
      rampPct: priorAvg ? miles / priorAvg - 1 : null,
    });
  }
  return weeks;
}
