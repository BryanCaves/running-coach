import type { Streams } from "../intervals/types.ts";
import { METERS_PER_MILE, paceSecPerMile } from "./units.ts";

// Below this speed the runner is stopped (lights, walking breaks); skip those samples.
const MOVING_MPS = 1.0;
// Optical wrist HR lags at the start, so drift ignores the warm-up.
const WARMUP_SEC = 5 * 60;
// Wrist HR is too noisy to read drift from short runs.
const MIN_DRIFT_SEC = 20 * 60;

export interface Split {
  mile: number;
  distanceM: number;
  paceSecPerMile: number;
  avgHr: number | null;
}

export type SplitPattern = "negative" | "even" | "fading" | "too_short";

export interface Drift {
  /** Avg HR in the second half minus the first half (bpm). */
  hrBpm: number;
  /** Pace:HR decoupling %. Positive = efficiency fell as the run went on. Under ~5% is solid aerobic fitness. */
  decouplingPct: number;
}

interface Segment {
  seconds: number;
  meters: number;
  hrSum: number;
  hrCount: number;
}

function emptySegment(): Segment {
  return { seconds: 0, meters: 0, hrSum: 0, hrCount: 0 };
}

/** Walks moving samples, calling `bucket` to decide which segment each belongs to. */
function accumulate(s: Streams, bucket: (i: number) => number | null): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < s.time.length; i++) {
    if ((s.velocity[i] ?? 0) < MOVING_MPS) continue;
    const b = bucket(i);
    if (b === null) continue;
    const seg = (segments[b] ??= emptySegment());
    seg.seconds += s.time[i]! - s.time[i - 1]!;
    seg.meters += s.distance[i]! - s.distance[i - 1]!;
    const hr = s.heartrate[i];
    if (hr) {
      seg.hrSum += hr;
      seg.hrCount++;
    }
  }
  return segments;
}

const avgHr = (seg: Segment) => (seg.hrCount ? seg.hrSum / seg.hrCount : null);
const speed = (seg: Segment) => seg.meters / seg.seconds;

export function mileSplits(s: Streams): Split[] {
  return accumulate(s, (i) => Math.floor(s.distance[i]! / METERS_PER_MILE))
    .map((seg, i) => ({ seg, i }))
    .filter(({ seg }) => seg && seg.seconds > 0)
    .map(({ seg, i }) => ({
      mile: i + 1,
      distanceM: seg.meters,
      paceSecPerMile: paceSecPerMile(speed(seg)),
      avgHr: avgHr(seg),
    }));
}

/** Compares second-half pace to first-half pace (by distance). */
export function splitPattern(s: Streams): SplitPattern {
  const total = s.distance.at(-1) ?? 0;
  if (total < 1.5 * METERS_PER_MILE) return "too_short";
  const [first, second] = accumulate(s, (i) => (s.distance[i]! < total / 2 ? 0 : 1));
  if (!first?.seconds || !second?.seconds) return "too_short";
  const change = speed(second) / speed(first) - 1;
  if (change > 0.02) return "negative";
  if (change < -0.03) return "fading";
  return "even";
}

/** HR drift over the run after warm-up. Null when there's too little HR data. */
export function hrDrift(s: Streams): Drift | null {
  const end = s.time.at(-1) ?? 0;
  if (end - WARMUP_SEC < MIN_DRIFT_SEC) return null;
  const mid = WARMUP_SEC + (end - WARMUP_SEC) / 2;
  const [first, second] = accumulate(s, (i) =>
    s.time[i]! < WARMUP_SEC ? null : s.time[i]! < mid ? 0 : 1,
  );
  const hr1 = first && avgHr(first);
  const hr2 = second && avgHr(second);
  if (!hr1 || !hr2) return null;
  const ef1 = speed(first) / hr1;
  const ef2 = speed(second) / hr2;
  return { hrBpm: hr2 - hr1, decouplingPct: ((ef1 - ef2) / ef1) * 100 };
}
