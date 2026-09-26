export const METERS_PER_MILE = 1609.344;

export const toMiles = (meters: number) => meters / METERS_PER_MILE;

export const paceSecPerMile = (metersPerSec: number) => METERS_PER_MILE / metersPerSec;

/** 612.4 → "10:12" */
export function formatPace(secPerMile: number): string {
  const total = Math.round(secPerMile);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 1995 → "33:15", 3725 → "1:02:05" */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
