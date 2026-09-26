import { describe, expect, it } from "vitest";
import type { RunSummary } from "../src/metrics/run.ts";
import { summarizeWeeks, weekStart } from "../src/metrics/week.ts";

function run(date: string, miles: number, easyPct: number | null = null): RunSummary {
  return {
    id: date, date, miles, movingSec: miles * 600, paceSecPerMile: 600, avgHr: 150,
    easyCeilingHr: 153, easyPct, load: 10, splits: [], pattern: "even", drift: null, efficiency: null,
  };
}

describe("weekStart", () => {
  it("returns the Monday of the week", () => {
    expect(weekStart("2026-09-24")).toBe("2026-09-21"); // Thursday
    expect(weekStart("2026-09-21")).toBe("2026-09-21"); // Monday
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday
  });
});

describe("summarizeWeeks", () => {
  it("includes empty weeks and computes ramp vs prior weeks", () => {
    const runs = [run("2026-09-01", 5), run("2026-09-03", 5), run("2026-09-15", 6), run("2026-09-22", 8)];
    const weeks = summarizeWeeks(runs, "2026-08-31", "2026-09-21");
    expect(weeks.map((w) => w.miles)).toEqual([10, 0, 6, 8]);
    expect(weeks[0]!.rampPct).toBeNull();
    expect(weeks[1]!.longestMiles).toBe(0);
    // 8 mi vs avg(10, 0, 6) ≈ 5.33 → +50%
    expect(weeks[3]!.rampPct).toBeCloseTo(0.5, 2);
  });

  it("time-weights easy percentage", () => {
    const [w] = summarizeWeeks([run("2026-09-22", 6, 1), run("2026-09-23", 2, 0)], "2026-09-21", "2026-09-21");
    expect(w!.easyPct).toBeCloseTo(0.75, 5);
  });
});
