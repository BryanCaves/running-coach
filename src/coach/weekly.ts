import { readFileSync } from "node:fs";
import { z } from "zod";
import type { RunSummary } from "../metrics/run.ts";
import { formatPace } from "../metrics/units.ts";
import { paceIntensity, type TrainingPaces } from "../metrics/vdot.ts";
import { addDays, type WeekSummary } from "../metrics/week.ts";
import type { Embed } from "../notify/discord.ts";
import type { WeekComparison } from "../plan/compare.ts";
import { checkWeekPlan, type RuleLimits } from "../plan/rules.ts";
import { isRun, WeekPlan, type Session } from "../plan/schema.ts";
import type { CoachModel } from "./model.ts";

export const WeeklyCoaching = z.object({
  status: z.enum(["on_track", "watch", "back_off"]),
  headline: z.string().describe("One-sentence verdict on the week"),
  flags: z
    .array(z.object({ kind: z.enum(["win", "warning"]), text: z.string() }))
    .min(1)
    .max(4),
  nextWeek: WeekPlan,
});
export type WeeklyCoaching = z.infer<typeof WeeklyCoaching>;

export interface Phase {
  name: string;
  nextGate: string;
}

export interface WeeklyInput {
  weekStart: string; // Monday of the week being reviewed
  plan: WeekPlan | null;
  comparison: WeekComparison | null;
  runs: RunSummary[]; // this week's runs
  weeks: WeekSummary[]; // history including this week
  paces: TrainingPaces;
  recent5k: string;
  hrZones: number[] | null;
  phase: Phase;
  limits: RuleLimits;
}

const pct = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);
const miles = (x: number) => +x.toFixed(1);

function zonesTable(zones: number[] | null) {
  if (!zones) return null;
  return zones.map((top, i) => `Z${i + 1}: ${i === 0 ? "≤" : `${(zones[i - 1] ?? 0) + 1}–`}${top}`);
}

export function buildWeeklyPrompt(i: WeeklyInput): string {
  const context = {
    weekReviewed: `${i.weekStart} to ${addDays(i.weekStart, 6)}`,
    nextWeek: `${addDays(i.weekStart, 7)} to ${addDays(i.weekStart, 13)}`,
    phase: i.phase,
    dataWindow: `Only runs since ${i.weeks[0]?.weekStart ?? i.weekStart} are included; earlier history is unknown.`,
    targets: {
      recent5k: i.recent5k,
      vdot: miles(i.paces.vdot),
      easyHrCeiling: i.runs[0]?.easyCeilingHr ?? i.hrZones?.[1] ?? null,
      hrZones: zonesTable(i.hrZones),
      paces: {
        easy: `${formatPace(i.paces.easy[0])}–${formatPace(i.paces.easy[1])}/mi`,
        marathon: `${formatPace(i.paces.marathon)}/mi`,
        threshold: `${formatPace(i.paces.threshold)}/mi`,
        interval: `${formatPace(i.paces.interval)}/mi`,
      },
    },
    limitsForNextWeek: { maxWeeklyMiles: miles(i.limits.maxMiles), maxLongRunMiles: miles(i.limits.maxLongRun) },
    thisWeek: {
      plan: i.plan ? { focus: i.plan.focus, targetMiles: i.plan.targetMiles } : "No plan existed for this week.",
      plannedRuns: i.comparison?.planned.map((p) => ({
        day: p.day,
        type: p.type,
        plannedMiles: p.plannedMiles,
        actualMiles: miles(p.actualMiles),
        outcome: p.outcome,
      })),
      unplannedRuns: i.comparison?.unplanned.map((r) => r.date),
      runs: i.runs.map((r) => ({
        date: r.date,
        miles: +r.miles.toFixed(2),
        pace: `${formatPace(r.paceSecPerMile)}/mi (${paceIntensity(r.paceSecPerMile, i.paces)})`,
        avgHr: r.avgHr,
        timeInEasyZones: pct(r.easyPct),
        splitPattern: r.pattern,
        hrDrift: r.drift ? { bpm: Math.round(r.drift.hrBpm), decouplingPct: +r.drift.decouplingPct.toFixed(1) } : null,
      })),
    },
    weeks: i.weeks.map((w) => ({
      weekOf: w.weekStart,
      runs: w.runs,
      miles: miles(w.miles),
      longRunMiles: miles(w.longestMiles),
      timeInEasyZones: pct(w.easyPct),
      volumeChangeVsPriorWeeks: pct(w.rampPct),
    })),
  };
  return `Review this week and plan next week.\n\n${JSON.stringify(context, null, 2)}`;
}

const SYSTEM_PROMPT = readFileSync(new URL("../../prompts/weekly_review.md", import.meta.url), "utf8");
const MAX_ATTEMPTS = 2;

/** Generates the review; if next week's plan breaks a training rule, asks once more with the violations. */
export async function coachWeek(model: CoachModel, input: WeeklyInput): Promise<WeeklyCoaching> {
  let prompt = buildWeeklyPrompt(input);
  let problems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const coaching = await model.generate({ system: SYSTEM_PROMPT, prompt, schema: WeeklyCoaching });
    problems = checkWeekPlan(coaching.nextWeek, input.limits);
    if (!problems.length) return coaching;
    prompt += `\n\nYour previous plan broke these rules. Fix them:\n- ${problems.join("\n- ")}`;
  }
  throw new Error(`Weekly plan still breaks training rules:\n- ${problems.join("\n- ")}`);
}

const STATUS_LABEL = { on_track: "🟢 On track", watch: "🟡 Watch this", back_off: "🔴 Back off" } as const;

const SESSION_LABEL: Record<Session["type"], string> = {
  easy_run: "🏃 Easy run",
  long_run: "🏃 Long run",
  tempo: "⚡ Tempo",
  intervals: "⚡ Intervals",
  upper: "💪 Upper body",
  lower: "🦵 Lower body",
  yoga: "🧘 Yoga",
  rest: "😴 Rest",
};

/** "2026-09-21" → "Sep 21" */
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function describeSession(s: Session): string {
  if (!isRun(s)) return `${SESSION_LABEL[s.type]}: ${s.detail}`;
  const targets = [s.miles && `${s.miles} mi`, s.hrTarget, s.paceGuide].filter(Boolean).join(" · ");
  return `${SESSION_LABEL[s.type]}: ${targets}\n${s.detail}`;
}

export function weeklyEmbeds(input: WeeklyInput, coaching: WeeklyCoaching): Embed[] {
  const week = input.weeks.at(-1);
  const c = input.comparison;
  const planned = c?.planned ?? [];
  const done = planned.filter((p) => p.outcome === "completed").length;
  const device = input.runs.find((r) => r.device)?.device ?? "Garmin";
  const footer = `Phase: ${input.phase.name} · Next gate: ${input.phase.nextGate} · Data: ${device} via intervals.icu`;

  const wins = coaching.flags.filter((f) => f.kind === "win").map((f) => `✅ ${f.text}`);
  const warnings = coaching.flags.filter((f) => f.kind === "warning").map((f) => `⚠️ ${f.text}`);

  const recap: Embed = {
    title: `📅 Week of ${shortDate(input.weekStart)} · Recap`,
    description: `**${STATUS_LABEL[coaching.status]}**\n${coaching.headline}`,
    status: coaching.status,
    fields: [
      {
        name: "Distance",
        value: c ? `${miles(c.actualMiles)} / ${miles(c.plannedMiles)} mi` : `${miles(week?.miles ?? 0)} mi`,
        inline: true,
      },
      { name: "Runs", value: c ? `${done} of ${planned.length} planned` : `${week?.runs ?? 0}`, inline: true },
      { name: "Long run", value: `${miles(week?.longestMiles ?? 0)} mi`, inline: true },
      { name: "Easy time", value: pct(week?.easyPct ?? null) ?? "–", inline: true },
      ...(wins.length ? [{ name: "Wins", value: wins.join("\n") }] : []),
      ...(warnings.length ? [{ name: "Watch", value: warnings.join("\n") }] : []),
    ],
    footer,
  };

  const next = coaching.nextWeek;
  const nextStart = addDays(input.weekStart, 7);
  const plan: Embed = {
    title: `🗓️ Next week · ${shortDate(nextStart)} – ${shortDate(addDays(nextStart, 6))}`,
    description: `**Focus:** ${next.focus}\n**Target:** ${miles(next.targetMiles)} mi`,
    status: coaching.status,
    fields: next.days.map((d) => ({
      name: d.day,
      value: `${d.sessions.map(describeSession).join("\n")}\n*${d.purpose}*`,
    })),
    footer,
  };
  return [recap, plan];
}
