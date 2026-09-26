import { z } from "zod";
import { Activity, RawStreams, type Streams } from "./types.ts";

const BASE = "https://intervals.icu/api/v1";

// Only these streams are ever requested. Never add latlng.
const STREAM_TYPES = ["time", "distance", "heartrate", "velocity_smooth"] as const;

/**
 * Keeps activities with usable data. Strava-imported activities can't be shared through the
 * intervals.icu API, so they're dropped (by source, or when required fields are missing)
 * instead of failing the whole batch.
 */
export function parseActivities(data: unknown): { activities: Activity[]; skipped: number } {
  const activities: Activity[] = [];
  let skipped = 0;
  for (const raw of z.array(z.unknown()).parse(data)) {
    const parsed = Activity.safeParse(raw);
    if (parsed.success && parsed.data.source !== "STRAVA") activities.push(parsed.data);
    else skipped++;
  }
  return { activities, skipped };
}

export class IntervalsClient {
  private readonly auth: string;

  constructor(
    apiKey: string,
    private readonly athleteId: string,
  ) {
    this.auth = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
  }

  /** Activities between two local dates (YYYY-MM-DD), inclusive. */
  async activities(oldest: string, newest: string): Promise<Activity[]> {
    const data = await this.get(`/athlete/${this.athleteId}/activities`, { oldest, newest });
    const { activities, skipped } = parseActivities(data);
    if (skipped) {
      console.error(
        `Skipped ${skipped} activit${skipped === 1 ? "y" : "ies"} without usable data ` +
          "(activities imported from Strava can't be read through the intervals.icu API).",
      );
    }
    return activities;
  }

  async streams(activityId: string): Promise<Streams> {
    const raw = RawStreams.parse(
      await this.get(`/activity/${activityId}/streams`, { types: STREAM_TYPES.join(",") }),
    );
    const byType = new Map(raw.map((s) => [s.type, s.data]));
    const numeric = (type: string) => (byType.get(type) ?? []).map((v) => v ?? 0);
    return {
      time: numeric("time"),
      distance: numeric("distance"),
      heartrate: byType.get("heartrate") ?? [],
      velocity: numeric("velocity_smooth"),
    };
  }

  private async get(path: string, query: Record<string, string>): Promise<unknown> {
    const url = `${BASE}${path}?${new URLSearchParams(query)}`;
    const res = await fetch(url, { headers: { Authorization: this.auth } });
    if (!res.ok) throw new Error(`intervals.icu ${res.status} on ${path}`);
    return res.json();
  }
}
