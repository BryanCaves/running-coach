import { describe, expect, it } from "vitest";
import type { RunSummary } from "../src/metrics/run.ts";
import { compareWeek } from "../src/plan/compare.ts";
import { checkWeekPlan, limitsFrom } from "../src/plan/rules.ts";
import { DAYS, type Session, type WeekPlan } from "../src/plan/schema.ts";

const run = (type: Session["type"], miles: number): Session => ({ type, miles, hrTarget: null, paceGuide: null, detail: "" });
const other = (type: Session["type"]): Session => ({ type, miles: null, hrTarget: null, paceGuide: null, detail: "" });

function plan(sessions: Session[][]): WeekPlan {
  const days = DAYS.map((day, i) => ({ day, sessions: sessions[i]!, purpose: "" }));
  const targetMiles = sessions.flat().reduce((sum, s) => sum + (s.miles ?? 0), 0);
  return { focus: "", targetMiles, days };
}

// Mon upper+easy, Tue lower, Wed yoga, Thu easy, Fri upper, Sat long, Sun rest
const good = plan([
  [other("upper"), run("easy_run", 1.5)],
  [other("lower")],
  [other("yoga")],
  [run("easy_run", 1.5)],
  [other("upper")],
  [run("long_run", 3.5)],
  [other("rest")],
]);
const limits = { maxMiles: 7, maxLongRun: 4 };

describe("checkWeekPlan", () => {
  it("accepts a plan that follows the rules", () => {
    expect(checkWeekPlan({ ...good, days: good.days.toSpliced(3, 1, { day: "Thu", sessions: [run("easy_run", 2)], purpose: "" }), targetMiles: 7 }, limits)).toEqual([]);
  });

  it("flags too few runs, missing strength and a hard run beside leg day", () => {
    const bad = plan([
      [other("upper")],
      [other("lower")],
      [run("tempo", 2)],
      [other("yoga")],
      [other("rest")],
      [run("long_run", 3.5)],
      [other("rest")],
    ]);
    const problems = checkWeekPlan(bad, limits).join("\n");
    expect(problems).toMatch(/2 runs/);
    expect(problems).toMatch(/2 upper/);
    expect(problems).toMatch(/Wed has a hard run/);
  });

  it("enforces ramp and long-run limits", () => {
    const problems = checkWeekPlan(good, { maxMiles: 5, maxLongRun: 3 }).join("\n");
    expect(problems).toMatch(/ramp limit/);
    expect(problems).toMatch(/Longest run/);
  });

  it("rejects runs too short to be worthwhile", () => {
    const tiny = { ...good, days: good.days.toSpliced(3, 1, { day: "Thu" as const, sessions: [run("easy_run", 0.8)], purpose: "" }), targetMiles: 5.8 };
    expect(checkWeekPlan(tiny, limits).join("\n")).toMatch(/at least 1.5 mi/);
  });
});

describe("limitsFrom", () => {
  it("ramps from the recent peak by ~10% or a small absolute step, whichever is larger", () => {
    expect(limitsFrom([5, 5, 2, 3.2], 3.2).maxMiles).toBeCloseTo(6.5, 5); // peak 5 → +1.5
    expect(limitsFrom([20, 20, 20], 6).maxMiles).toBeCloseTo(22, 5); // 10%
    expect(limitsFrom([5], 3.2).maxLongRun).toBeCloseTo(4.2, 5);
  });
});

describe("compareWeek", () => {
  const r = (date: string, miles: number) => ({ id: date, date, miles }) as RunSummary;
  it("marks completed, partial, missed and upcoming runs", () => {
    const week = "2026-09-21"; // Monday
    const result = compareWeek(good, week, [r("2026-09-21", 1.4), r("2026-09-24", 0.8), r("2026-09-23", 2)], "2026-09-25");
    expect(result.planned.map((p) => p.outcome)).toEqual(["completed", "partial", "upcoming"]);
    expect(result.unplanned.map((u) => u.date)).toEqual(["2026-09-23"]);
    expect(result.actualMiles).toBeCloseTo(4.2, 5);
    expect(compareWeek(good, week, [], "2026-09-28").planned.map((p) => p.outcome)).toEqual(["missed", "missed", "missed"]);
  });
});
