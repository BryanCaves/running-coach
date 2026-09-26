import { describe, expect, it } from "vitest";
import type { Streams } from "../src/intervals/types.ts";
import { hrDrift, mileSplits, splitPattern } from "../src/metrics/splits.ts";
import { METERS_PER_MILE } from "../src/metrics/units.ts";

/** 1 Hz stream; speed and HR are functions of elapsed seconds. */
function stream(seconds: number, speed: (t: number) => number, hr: (t: number) => number): Streams {
  const s: Streams = { time: [], distance: [], heartrate: [], velocity: [] };
  let d = 0;
  for (let t = 0; t <= seconds; t++) {
    const v = speed(t);
    if (t > 0) d += v;
    s.time.push(t);
    s.distance.push(d);
    s.velocity.push(v);
    s.heartrate.push(hr(t));
  }
  return s;
}

const MIN = 60;

describe("mileSplits", () => {
  it("splits a steady run into miles with a partial last split", () => {
    const s = stream(30 * MIN, () => 2.682, () => 150); // 10:00/mi
    const splits = mileSplits(s);
    expect(splits).toHaveLength(3);
    expect(splits[0]!.paceSecPerMile).toBeCloseTo(600, 0);
    expect(splits[0]!.avgHr).toBe(150);
    expect(splits[2]!.distanceM).toBeLessThan(METERS_PER_MILE);
  });

  it("skips stopped time", () => {
    const s = stream(20 * MIN, (t) => (t > 5 * MIN && t < 8 * MIN ? 0 : 2.682), () => 150);
    expect(mileSplits(s)[0]!.paceSecPerMile).toBeCloseTo(600, 0);
  });
});

describe("splitPattern", () => {
  it("detects even, fading and negative splits", () => {
    expect(splitPattern(stream(30 * MIN, () => 2.7, () => 150))).toBe("even");
    expect(splitPattern(stream(30 * MIN, (t) => (t < 15 * MIN ? 2.8 : 2.5), () => 150))).toBe("fading");
    expect(splitPattern(stream(30 * MIN, (t) => (t < 15 * MIN ? 2.6 : 2.8), () => 150))).toBe("negative");
  });

  it("returns too_short under 1.5 miles", () => {
    expect(splitPattern(stream(10 * MIN, () => 2.7, () => 150))).toBe("too_short");
  });
});

describe("hrDrift", () => {
  it("measures rising HR at constant pace as positive decoupling", () => {
    const s = stream(45 * MIN, () => 2.7, (t) => 140 + (t / (45 * MIN)) * 16);
    const drift = hrDrift(s)!;
    expect(drift.hrBpm).toBeGreaterThan(6);
    expect(drift.decouplingPct).toBeGreaterThan(3);
  });

  it("ignores warm-up HR", () => {
    const s = stream(40 * MIN, () => 2.7, (t) => (t < 5 * MIN ? 110 : 150));
    expect(hrDrift(s)!.hrBpm).toBeCloseTo(0, 5);
  });

  it("returns null for runs too short to judge", () => {
    expect(hrDrift(stream(20 * MIN, () => 2.7, () => 150))).toBeNull();
  });
});
