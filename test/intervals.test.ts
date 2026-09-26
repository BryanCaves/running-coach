import { describe, expect, it } from "vitest";
import { parseActivities } from "../src/intervals/client.ts";
import { dataCredit } from "../src/notify/discord.ts";

const activity = (id: string, source: string) => ({
  id,
  type: "Run",
  start_date_local: "2026-09-24T18:09:58",
  source,
  device_name: "Garmin Forerunner 165",
  distance: 5000,
  moving_time: 1800,
  elapsed_time: 1850,
  route_id: 123, // stripped by the schema
});

describe("parseActivities", () => {
  it("keeps usable activities and skips Strava imports and stubs", () => {
    const { activities, skipped } = parseActivities([
      activity("i1", "GARMIN_CONNECT"),
      activity("i2", "STRAVA"),
      { id: "i3", start_date_local: "2026-09-25T07:00:00", source: "STRAVA" }, // stub without data
      activity("i4", "COROS"),
    ]);
    expect(activities.map((a) => a.id)).toEqual(["i1", "i4"]);
    expect(skipped).toBe(2);
    expect(activities[0]).not.toHaveProperty("route_id");
  });
});

describe("dataCredit", () => {
  it("names the device when known", () => {
    expect(dataCredit("COROS PACE 3")).toBe("Data: COROS PACE 3 via intervals.icu");
    expect(dataCredit(null)).toBe("Data: intervals.icu");
  });
});
