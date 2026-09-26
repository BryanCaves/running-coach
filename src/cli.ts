import { requireEnv } from "./config.ts";
import { createCoachModel } from "./coach/model.ts";
import { coachRun, postRunEmbed } from "./coach/postRun.ts";
import { IntervalsClient } from "./intervals/client.ts";
import type { Activity } from "./intervals/types.ts";
import { summarizeRun, type RunSummary } from "./metrics/run.ts";
import { formatDuration, formatPace } from "./metrics/units.ts";
import { trainingPaces, vdot, type TrainingPaces } from "./metrics/vdot.ts";
import { addDays, summarizeWeeks, weekStart } from "./metrics/week.ts";
import { postToDiscord, type Embed } from "./notify/discord.ts";
import { Redis, RunLog } from "./store/redis.ts";

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const HISTORY_WEEKS = 5;
// Runs older than this are never coached, even if unposted (e.g. a late Garmin sync of old data).
const NEW_RUN_DAYS = 3;

const today = () => new Date().toISOString().slice(0, 10);
const isRun = (a: Activity) => RUN_TYPES.has(a.type);

function intervalsClient() {
  return new IntervalsClient(requireEnv("INTERVALS_API_KEY"), requireEnv("INTERVALS_ATHLETE_ID"));
}

async function summarize(client: IntervalsClient, activities: Activity[]): Promise<RunSummary[]> {
  const runs: RunSummary[] = [];
  for (const a of activities) runs.push(summarizeRun(a, await client.streams(a.id)));
  return runs.sort((a, b) => a.date.localeCompare(b.date));
}

/** Parses "29:16.9" or "1:02:05" into seconds. */
function parseTime(s: string): number {
  return s.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

interface Context {
  client: IntervalsClient;
  firstWeek: string;
  activities: Activity[];
  paces: TrainingPaces;
  recent5k: string;
}

async function loadContext(): Promise<Context> {
  const client = intervalsClient();
  const recent5k = requireEnv("ATHLETE_5K_TIME");
  const firstWeek = addDays(weekStart(today()), -7 * (HISTORY_WEEKS - 1));
  return {
    client,
    firstWeek,
    activities: (await client.activities(firstWeek, today())).filter(isRun),
    paces: trainingPaces(vdot(5000, parseTime(recent5k))),
    recent5k,
  };
}

/** Coaches each target run in date order and hands the embed to `send`. */
async function coachRuns(ctx: Context, targetIds: Set<string>, send: (run: RunSummary, embed: Embed) => Promise<void>) {
  const runs = await summarize(ctx.client, ctx.activities);
  const model = createCoachModel();
  for (const run of runs.filter((r) => targetIds.has(r.id))) {
    const earlier = runs.filter((r) => r.date <= run.date && r.id !== run.id);
    const coaching = await coachRun(model, {
      run,
      recentRuns: earlier.slice(-8),
      weeks: summarizeWeeks([...earlier, run], ctx.firstWeek, weekStart(run.date)),
      paces: ctx.paces,
      recent5k: ctx.recent5k,
    });
    await send(run, postRunEmbed(run, coaching));
  }
}

const printEmbed = async (_: RunSummary, embed: Embed) => console.log(JSON.stringify(embed, null, 2));

async function poll({ dryRun }: { dryRun: boolean }) {
  const ctx = await loadContext();
  const log = new RunLog(new Redis(requireEnv("UPSTASH_REDIS_REST_URL"), requireEnv("UPSTASH_REDIS_REST_TOKEN")));
  const posted = await log.posted(ctx.activities.map((a) => a.id));
  const cutoff = addDays(today(), -NEW_RUN_DAYS);
  let pending = ctx.activities.filter((a) => !posted.has(a.id) && a.start_date_local >= cutoff);

  // First ever poll: coach only the latest run and treat older history as already posted.
  if (!dryRun && (await log.isEmpty())) {
    pending = pending.slice(-1);
    await log.markPosted(...ctx.activities.filter((a) => !pending.includes(a)).map((a) => a.id));
  }
  if (!pending.length) {
    console.log("No new runs.");
    return;
  }

  await coachRuns(ctx, new Set(pending.map((a) => a.id)), async (run, embed) => {
    if (dryRun) return printEmbed(run, embed);
    await postToDiscord(requireEnv("DISCORD_WEBHOOK_RUN_LOG"), [embed]);
    await log.markPosted(run.id);
    // Workflow logs are public: log IDs only, never metrics.
    console.log(`Posted coaching for activity ${run.id}.`);
  });
}

/** Re-coaches the latest run and posts it without touching the posted-runs log (for testing the format). */
async function preview({ dryRun }: { dryRun: boolean }) {
  const ctx = await loadContext();
  const latest = ctx.activities.toSorted((a, b) => a.start_date_local.localeCompare(b.start_date_local)).at(-1);
  if (!latest) {
    console.log("No runs in range.");
    return;
  }
  await coachRuns(ctx, new Set([latest.id]), async (run, embed) => {
    if (dryRun) return printEmbed(run, embed);
    await postToDiscord(requireEnv("DISCORD_WEBHOOK_RUN_LOG"), [embed]);
    console.log(`Posted preview for activity ${run.id}.`);
  });
}

async function spike(weeks: number) {
  const client = intervalsClient();
  const lastWeek = weekStart(today());
  const firstWeek = addDays(lastWeek, -7 * (weeks - 1));
  const activities = await client.activities(firstWeek, today());
  const runs = await summarize(client, activities.filter(isRun));
  const other = activities.filter((a) => !isRun(a)).map((a) => a.type);

  console.log(`\nRuns ${firstWeek} → ${today()}\n`);
  for (const r of runs) {
    const drift = r.drift
      ? `drift ${r.drift.hrBpm >= 0 ? "+" : ""}${r.drift.hrBpm.toFixed(0)} bpm, decoupling ${r.drift.decouplingPct.toFixed(1)}%`
      : "drift n/a (too short)";
    console.log(
      `${r.date}  ${r.miles.toFixed(2)} mi  ${formatDuration(r.movingSec)}  ${formatPace(r.paceSecPerMile)}/mi  ` +
        `HR ${r.avgHr ?? "–"}  easy ${pct(r.easyPct)}  ${r.pattern}  ${drift}  load ${r.load ?? "–"}`,
    );
    console.log(
      "    splits: " +
        r.splits
          .map((s) => `${formatPace(s.paceSecPerMile)}${s.avgHr ? `@${s.avgHr.toFixed(0)}` : ""}${s.distanceM < 1500 ? "*" : ""}`)
          .join("  "),
    );
  }

  console.log("\nWeeks\n");
  for (const w of summarizeWeeks(runs, firstWeek, lastWeek)) {
    const ramp = w.rampPct === null ? "" : `  ramp ${w.rampPct >= 0 ? "+" : ""}${pct(w.rampPct)}`;
    console.log(
      `${w.weekStart}  ${w.runs} runs  ${w.miles.toFixed(1)} mi  long ${w.longestMiles.toFixed(1)} mi  ` +
        `load ${w.load}  easy ${pct(w.easyPct)}${ramp}`,
    );
  }

  const ceiling = runs.find((r) => r.easyCeilingHr)?.easyCeilingHr;
  if (ceiling) console.log(`\nEasy = HR ≤ ${ceiling} (Z1–Z2 from intervals.icu zones)`);
  if (other.length) console.log(`Other activities: ${other.join(", ")}`);
  console.log("* partial final split\n");
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "poll":
    await poll({ dryRun: args.includes("--dry-run") });
    break;
  case "preview":
    await preview({ dryRun: args.includes("--dry-run") });
    break;
  case "spike":
    await spike(Number(args[0] ?? 4));
    break;
  default:
    console.log("Usage: npm run coach -- <poll [--dry-run] | preview [--dry-run] | spike [weeks]>");
    process.exitCode = 1;
}
