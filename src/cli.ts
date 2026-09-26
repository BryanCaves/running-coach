import { requireEnv } from "./config.ts";
import { IntervalsClient } from "./intervals/client.ts";
import { summarizeRun, type RunSummary } from "./metrics/run.ts";
import { addDays, summarizeWeeks, weekStart } from "./metrics/week.ts";
import { formatDuration, formatPace } from "./metrics/units.ts";

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

async function spike(weeks: number) {
  const client = new IntervalsClient(requireEnv("INTERVALS_API_KEY"), requireEnv("INTERVALS_ATHLETE_ID"));
  const today = new Date().toISOString().slice(0, 10);
  const lastWeek = weekStart(today);
  const firstWeek = addDays(lastWeek, -7 * (weeks - 1));

  const activities = await client.activities(firstWeek, today);
  const runs: RunSummary[] = [];
  for (const a of activities.filter((a) => RUN_TYPES.has(a.type))) {
    runs.push(summarizeRun(a, await client.streams(a.id)));
  }
  runs.sort((a, b) => a.date.localeCompare(b.date));
  const other = activities.filter((a) => !RUN_TYPES.has(a.type)).map((a) => a.type);

  console.log(`\nRuns ${firstWeek} → ${today}\n`);
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
  case "spike":
    await spike(Number(args[0] ?? 4));
    break;
  default:
    console.log("Usage: npm run coach -- spike [weeks]");
    process.exitCode = 1;
}
