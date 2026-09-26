import { z } from "zod";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const RUN_TYPES = ["easy_run", "long_run", "tempo", "intervals"] as const;
export const SESSION_TYPES = [...RUN_TYPES, "upper", "lower", "yoga", "rest"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** Runs that must not sit next to leg day. */
export const HARD_RUNS: ReadonlySet<SessionType> = new Set(["long_run", "tempo", "intervals"]);

export const Session = z.object({
  type: z.enum(SESSION_TYPES),
  miles: z.number().nullable().describe("Runs only; null otherwise"),
  hrTarget: z.string().nullable().describe('Runs only, e.g. "HR ≤ 153"'),
  paceGuide: z.string().nullable().describe('Runs only, e.g. "11:47–12:56/mi"'),
  detail: z.string().describe("What to do, briefly (structure for workouts, focus for strength/yoga)"),
});
export type Session = z.infer<typeof Session>;

export const Day = z.object({
  day: z.enum(DAYS),
  sessions: z.array(Session).min(1).max(2),
  purpose: z.string().describe("Why this day looks like this, one short sentence"),
});

export const WeekPlan = z.object({
  focus: z.string().describe("The one thing this week is about"),
  targetMiles: z.number().describe("Sum of planned run miles"),
  days: z.array(Day).length(7),
});
export type WeekPlan = z.infer<typeof WeekPlan>;

export const isRun = (s: Session) => (RUN_TYPES as readonly string[]).includes(s.type);
