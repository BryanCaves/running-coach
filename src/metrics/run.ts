import type { Activity, Streams } from "../intervals/types.ts";
import { hrDrift, mileSplits, splitPattern, type Drift, type Split, type SplitPattern } from "./splits.ts";
import { paceSecPerMile, toMiles } from "./units.ts";

// intervals.icu's default running zones are LTHR-based; Z1–Z2 is genuinely easy.
const EASY_ZONE_COUNT = 2;

export interface RunSummary {
  id: string;
  date: string; // local YYYY-MM-DD
  device: string | null;
  miles: number;
  movingSec: number;
  paceSecPerMile: number;
  avgHr: number | null;
  easyCeilingHr: number | null;
  /** Share of HR-recorded time spent in Z1–Z2. */
  easyPct: number | null;
  load: number | null;
  splits: Split[];
  pattern: SplitPattern;
  drift: Drift | null;
  /** Meters per minute per heartbeat; rising over weeks at easy effort = aerobic gains. */
  efficiency: number | null;
}

export function summarizeRun(a: Activity, s: Streams): RunSummary {
  const zoneTimes = a.icu_hr_zone_times ?? [];
  const zoneTotal = zoneTimes.reduce((x, y) => x + y, 0);
  const easyTime = zoneTimes.slice(0, EASY_ZONE_COUNT).reduce((x, y) => x + y, 0);
  const speed = a.average_speed ?? a.distance / a.moving_time;
  return {
    id: a.id,
    date: a.start_date_local.slice(0, 10),
    device: a.device_name ?? null,
    miles: toMiles(a.distance),
    movingSec: a.moving_time,
    paceSecPerMile: paceSecPerMile(speed),
    avgHr: a.average_heartrate ?? null,
    easyCeilingHr: a.icu_hr_zones?.[EASY_ZONE_COUNT - 1] ?? null,
    easyPct: zoneTotal ? easyTime / zoneTotal : null,
    load: a.icu_training_load ?? null,
    splits: mileSplits(s),
    pattern: splitPattern(s),
    drift: hrDrift(s),
    efficiency: a.average_heartrate ? (speed * 60) / a.average_heartrate : null,
  };
}
