import type { RunSummary } from "../metrics/run.ts";
import { addDays } from "../metrics/week.ts";
import { DAYS, isRun, type WeekPlan } from "./schema.ts";

// A run counts as completed at ≥75% of planned distance (see docs/design.md).
const COMPLETED_FRACTION = 0.75;

export type Outcome = "completed" | "partial" | "missed" | "upcoming";

export interface PlannedRunResult {
  day: (typeof DAYS)[number];
  date: string;
  type: string;
  plannedMiles: number;
  actualMiles: number;
  outcome: Outcome;
}

export interface WeekComparison {
  plannedMiles: number;
  actualMiles: number;
  planned: PlannedRunResult[];
  /** Runs on days with no planned run. */
  unplanned: RunSummary[];
}

/** Matches actual runs to the plan by date. `weekStart` is the plan's Monday. */
export function compareWeek(plan: WeekPlan, weekStart: string, runs: RunSummary[], today: string): WeekComparison {
  const inWeek = runs.filter((r) => r.date >= weekStart && r.date <= addDays(weekStart, 6));
  const planned: PlannedRunResult[] = [];
  const plannedDates = new Set<string>();

  plan.days.forEach((d, i) => {
    const date = addDays(weekStart, i);
    for (const s of d.sessions.filter(isRun)) {
      plannedDates.add(date);
      const actualMiles = inWeek.filter((r) => r.date === date).reduce((sum, r) => sum + r.miles, 0);
      const target = s.miles ?? 0;
      const outcome: Outcome =
        actualMiles >= target * COMPLETED_FRACTION ? "completed"
        : actualMiles > 0 ? "partial"
        : date > today ? "upcoming"
        : "missed";
      planned.push({ day: d.day, date, type: s.type, plannedMiles: target, actualMiles, outcome });
    }
  });

  return {
    plannedMiles: planned.reduce((sum, p) => sum + p.plannedMiles, 0),
    actualMiles: inWeek.reduce((sum, r) => sum + r.miles, 0),
    planned,
    unplanned: inWeek.filter((r) => !plannedDates.has(r.date)),
  };
}
