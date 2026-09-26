import { DAYS, HARD_RUNS, isRun, type WeekPlan } from "./schema.ts";

export interface RuleLimits {
  /** Highest weekly mileage allowed next week. */
  maxMiles: number;
  /** Longest single run allowed next week. */
  maxLongRun: number;
}

// ~10%/week guideline, but at low mileage 10% is tiny, so allow a small absolute step.
const RAMP = 0.1;
const MIN_STEP_MILES = 1.5;
const LONG_RUN_STEP_MILES = 1;
// Shorter runs (~20 min at easy pace) aren't worth lacing up for.
const MIN_RUN_MILES = 1.5;

/**
 * Limits for next week from recent weekly miles and the recent longest run.
 * Ramps from the recent peak week: returning to volume handled a few weeks ago is safe.
 */
export function limitsFrom(recentWeekMiles: number[], recentLongestRun: number): RuleLimits {
  const base = Math.max(0, ...recentWeekMiles);
  return {
    maxMiles: Math.max(base * (1 + RAMP), base + MIN_STEP_MILES),
    maxLongRun: recentLongestRun + LONG_RUN_STEP_MILES,
  };
}

/** Returns human-readable rule violations; empty when the plan is acceptable. */
export function checkWeekPlan(plan: WeekPlan, limits: RuleLimits): string[] {
  const problems: string[] = [];
  const order = plan.days.map((d) => d.day).join(",");
  if (order !== DAYS.join(",")) problems.push(`Days must be Mon→Sun, each once (got ${order}).`);

  const sessions = plan.days.flatMap((d) => d.sessions);
  const runs = sessions.filter(isRun);
  const count = (type: string) => sessions.filter((s) => s.type === type).length;

  if (runs.length < 3 || runs.length > 4) problems.push(`Plan ${runs.length} runs; target is 3–4.`);
  if (count("upper") < 2) problems.push(`Plan at least 2 upper-body days (got ${count("upper")}).`);
  if (count("lower") < 1) problems.push("Plan at least 1 lower-body/legs day.");
  if (runs.some((r) => !r.miles || r.miles < MIN_RUN_MILES))
    problems.push(`Every run needs at least ${MIN_RUN_MILES} mi (about 20 minutes).`);

  const miles = runs.reduce((sum, r) => sum + (r.miles ?? 0), 0);
  if (Math.abs(miles - plan.targetMiles) > 0.25)
    problems.push(`targetMiles (${plan.targetMiles}) must equal the sum of run miles (${miles.toFixed(1)}).`);
  if (miles > limits.maxMiles + 0.05)
    problems.push(`Weekly total ${miles.toFixed(1)} mi exceeds the safe ramp limit of ${limits.maxMiles.toFixed(1)} mi.`);

  const longest = Math.max(0, ...runs.map((r) => r.miles ?? 0));
  if (longest > limits.maxLongRun + 0.05)
    problems.push(`Longest run ${longest.toFixed(1)} mi exceeds the limit of ${limits.maxLongRun.toFixed(1)} mi.`);

  plan.days.forEach((d, i) => {
    if (!d.sessions.some((s) => s.type === "lower")) return;
    for (const j of [i - 1, i, i + 1]) {
      const near = plan.days[j];
      if (near?.sessions.some((s) => HARD_RUNS.has(s.type)))
        problems.push(`${near.day} has a hard run (long/tempo/intervals) next to leg day on ${d.day}.`);
    }
  });
  return problems;
}
