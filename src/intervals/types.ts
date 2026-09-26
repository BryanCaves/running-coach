import { z } from "zod";

// Whitelist of activity fields we keep. Zod strips everything else, so route IDs
// and any location data never enter the app.
export const Activity = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string().nullish(),
  start_date_local: z.string(),
  source: z.string().nullish(),
  device_name: z.string().nullish(),
  distance: z.number(), // meters
  moving_time: z.number(), // seconds
  elapsed_time: z.number(),
  average_speed: z.number().nullish(), // m/s
  average_heartrate: z.number().nullish(),
  max_heartrate: z.number().nullish(),
  total_elevation_gain: z.number().nullish(),
  icu_training_load: z.number().nullish(),
  icu_hr_zones: z.array(z.number()).nullish(), // upper bound (bpm) of each zone
  icu_hr_zone_times: z.array(z.number()).nullish(), // seconds in each zone
  lthr: z.number().nullish(),
  feel: z.number().nullish(),
  perceived_exertion: z.number().nullish(),
});
export type Activity = z.infer<typeof Activity>;

export const RawStreams = z.array(
  z.object({
    type: z.string(),
    data: z.array(z.number().nullable()),
  }),
);

export interface Streams {
  time: number[]; // seconds from start
  distance: number[]; // meters
  heartrate: (number | null)[];
  velocity: number[]; // m/s, smoothed
}
