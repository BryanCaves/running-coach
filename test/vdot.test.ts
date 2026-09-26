import { describe, expect, it } from "vitest";
import { paceIntensity, predictTime, trainingPaces, vdot } from "../src/metrics/vdot.ts";

describe("vdot", () => {
  it("matches Daniels' tables for known performances", () => {
    expect(vdot(5000, 30 * 60)).toBeCloseTo(30.8, 1); // 30:00 5K ≈ VDOT 30.8
    expect(vdot(5000, 20 * 60)).toBeCloseTo(49.8, 1); // 20:00 5K ≈ VDOT 49.8
  });

  it("round-trips through predictTime", () => {
    const v = vdot(5000, 1756.9);
    expect(predictTime(v, 5000)).toBeCloseTo(1756.9, 0);
  });

  it("orders training paces from slowest to fastest", () => {
    const p = trainingPaces(vdot(5000, 1756.9));
    expect(p.easy[1]).toBeGreaterThan(p.easy[0]);
    expect(p.easy[0]).toBeGreaterThan(p.marathon);
    expect(p.marathon).toBeGreaterThan(p.threshold);
    expect(p.threshold).toBeGreaterThan(p.interval);
    expect(p.interval).toBeGreaterThan(p.repetition);
  });
});

describe("paceIntensity", () => {
  const p = trainingPaces(vdot(5000, 1756.9)); // easy from ~11:47, threshold ~9:52
  it("labels paces against VDOT targets", () => {
    expect(paceIntensity(12 * 60 + 30, p)).toBe("easy");
    expect(paceIntensity(10 * 60 + 33, p)).toBe("moderate (between easy and threshold)");
    expect(paceIntensity(9 * 60 + 55, p)).toBe("threshold");
    expect(paceIntensity(9 * 60, p)).toBe("faster than threshold");
  });
});
