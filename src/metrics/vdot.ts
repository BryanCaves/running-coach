import { METERS_PER_MILE } from "./units.ts";

// Daniels/Gilbert oxygen-cost and time-to-exhaustion formulas.
const vo2AtSpeed = (mPerMin: number) => -4.6 + 0.182258 * mPerMin + 0.000104 * mPerMin ** 2;
const fractionSustainable = (minutes: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);

/** Inverse of vo2AtSpeed: the speed (m/min) that costs `vo2`. */
function speedAtVo2(vo2: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export function vdot(distanceM: number, seconds: number): number {
  const minutes = seconds / 60;
  return vo2AtSpeed(distanceM / minutes) / fractionSustainable(minutes);
}

/** Seconds per mile at a given fraction of VDOT. */
const paceAt = (v: number, fraction: number) => (METERS_PER_MILE / speedAtVo2(v * fraction)) * 60;

export interface TrainingPaces {
  vdot: number;
  /** [fast, slow] seconds per mile. */
  easy: [number, number];
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
}

// Approximate %VO2max for each Daniels training intensity.
export function trainingPaces(v: number): TrainingPaces {
  return {
    vdot: v,
    easy: [paceAt(v, 0.7), paceAt(v, 0.62)],
    marathon: paceAt(v, 0.8),
    threshold: paceAt(v, 0.88),
    interval: paceAt(v, 0.975),
    repetition: paceAt(v, 1.05),
  };
}

/** Predicted race time (seconds) for another distance at the same VDOT. */
export function predictTime(v: number, distanceM: number): number {
  let lo = 60;
  let hi = 6 * 3600;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distanceM, mid) > v) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Threshold band: within ~3% of threshold pace.
const THRESHOLD_BAND = 0.03;

/** Labels a pace against the runner's VDOT paces so the model never compares pace strings itself. */
export function paceIntensity(secPerMile: number, p: TrainingPaces): string {
  if (secPerMile >= p.easy[0]) return "easy";
  if (secPerMile > p.threshold * (1 + THRESHOLD_BAND)) return "moderate (between easy and threshold)";
  if (secPerMile >= p.threshold * (1 - THRESHOLD_BAND)) return "threshold";
  return "faster than threshold";
}
