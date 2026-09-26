import { readFileSync } from "node:fs";
import { z } from "zod";
import type { RunSummary } from "../metrics/run.ts";
import { formatDuration, formatPace } from "../metrics/units.ts";
import { paceIntensity, type TrainingPaces } from "../metrics/vdot.ts";
import type { WeekSummary } from "../metrics/week.ts";
import type { Embed } from "../notify/discord.ts";
import type { Session } from "../plan/schema.ts";
import type { CoachModel } from "./model.ts";

export const PostRunCoaching = z.object({
  status: z.enum(["on_track", "watch", "back_off"]),
  headline: z.string().describe("One-sentence verdict on this run"),
  points: z
    .array(
      z.object({
        title: z.string().describe("3–6 word label"),
        insight: z.string().describe("What the data means"),
        why: z.string().describe("Why it matters for the 10K/half goal"),
        action: z.string().describe("Specific next action"),
      }),
    )
    .min(1)
    .max(3),
});
export type PostRunCoaching = z.infer<typeof PostRunCoaching>;

export interface PostRunInput {
  run: RunSummary;
  /** This week's plan and the sessions planned for the run's day, when a plan exists. */
  plan: { focus: string; plannedToday: Session[] } | null;
  recentRuns: RunSummary[];
  weeks: WeekSummary[];
  paces: TrainingPaces;
  recent5k: string;
}

const pct = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);

const paceWithIntensity = (secPerMile: number, p: TrainingPaces) =>
  `${formatPace(secPerMile)}/mi (${paceIntensity(secPerMile, p)})`;

function describeRun(r: RunSummary, p: TrainingPaces) {
  return {
    date: r.date,
    miles: +r.miles.toFixed(2),
    duration: formatDuration(r.movingSec),
    pace: paceWithIntensity(r.paceSecPerMile, p),
    avgHr: r.avgHr,
    timeInEasyZones: pct(r.easyPct),
    splitPattern: r.pattern,
  };
}

export function buildPostRunPrompt({ run, plan, recentRuns, weeks, paces, recent5k }: PostRunInput): string {
  const context = {
    phase: plan ? "Base building, following a weekly plan" : "Pre-plan base building (no structured plan yet)",
    weekFocus: plan?.focus,
    plannedToday: plan
      ? plan.plannedToday.length ? plan.plannedToday : "Nothing planned for this day (an extra run)."
      : undefined,
    dataWindow: `Only runs since ${weeks[0]?.weekStart ?? run.date} are included; earlier history is unknown.`,
    targets: {
      easyHrCeiling: run.easyCeilingHr,
      recent5k,
      vdot: +paces.vdot.toFixed(1),
      paces: {
        easy: `${formatPace(paces.easy[0])}–${formatPace(paces.easy[1])}/mi`,
        threshold: `${formatPace(paces.threshold)}/mi`,
        interval: `${formatPace(paces.interval)}/mi`,
      },
    },
    thisRun: {
      ...describeRun(run, paces),
      mileSplits: run.splits.map((s) => ({
        mile: s.mile,
        pace: paceWithIntensity(s.paceSecPerMile, paces),
        avgHr: s.avgHr && Math.round(s.avgHr),
        partial: s.distanceM < 1500 || undefined,
      })),
      hrDrift: run.drift
        ? { bpm: Math.round(run.drift.hrBpm), decouplingPct: +run.drift.decouplingPct.toFixed(1) }
        : "not measured (run too short for reliable wrist HR drift)",
    },
    previousRuns: recentRuns.map((r) => describeRun(r, paces)),
    weeks: weeks.map((w) => ({
      weekOf: w.weekStart,
      runs: w.runs,
      miles: +w.miles.toFixed(1),
      longRunMiles: +w.longestMiles.toFixed(1),
      timeInEasyZones: pct(w.easyPct),
      volumeChangeVsPriorWeeks: pct(w.rampPct),
    })),
  };
  return `Review this run.\n\n${JSON.stringify(context, null, 2)}`;
}

const SYSTEM_PROMPT = readFileSync(new URL("../../prompts/post_run.md", import.meta.url), "utf8");

export function coachRun(model: CoachModel, input: PostRunInput): Promise<PostRunCoaching> {
  return model.generate({ system: SYSTEM_PROMPT, prompt: buildPostRunPrompt(input), schema: PostRunCoaching });
}

const STATUS_LABEL = {
  on_track: "🟢 On track",
  watch: "🟡 Watch this",
  back_off: "🔴 Back off",
} as const;

/** "2026-09-24" → "Thu, Sep 24" */
function formatDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function postRunEmbed(run: RunSummary, coaching: PostRunCoaching): Embed {
  const glance = [
    { name: "Distance", value: `${run.miles.toFixed(2)} mi`, inline: true },
    { name: "Pace", value: `${formatPace(run.paceSecPerMile)} /mi`, inline: true },
    { name: "Avg HR", value: run.avgHr ? `${Math.round(run.avgHr)} bpm` : "–", inline: true },
  ];
  const points = coaching.points.map((p, i) => ({
    name: `${i + 1}. ${p.title}`,
    value: `${p.insight}\n\n**Why it matters:** ${p.why}\n\n**Next:** ${p.action}`,
  }));
  return {
    title: `🏃 ${formatDate(run.date)} · ${run.miles.toFixed(1)} mi run`,
    description: `**${STATUS_LABEL[coaching.status]}**\n${coaching.headline}`,
    status: coaching.status,
    fields: [...glance, ...points],
    // Garmin's API terms require attribution on anything derived from Garmin data.
    footer: `Data: ${run.device ?? "Garmin"} via intervals.icu`,
  };
}
