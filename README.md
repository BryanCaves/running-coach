# running-coach

A personal AI running coach that reads your watch data (Garmin, COROS, Polar and others, via [intervals.icu](https://intervals.icu)), works out what it means, and posts real coaching to a private Discord server.

Instead of repeating stats your watch already shows ("3.2 mi, 10:33/mi, avg HR 175"), it tells you what they mean and what to do next:

> **1. Easy runs are running hard**
> Only 5% of this run was in your easy zones, and the last five runs look the same.
>
> **Why it matters:** The aerobic base that carries you to a 10K is built by easy miles, not by threshold efforts at 3 miles.
>
> **Next:** Cap Saturday's run at HR 153. Walk 30 seconds whenever it creeps over.

Built for a hybrid runner (3–4 runs plus 3 strength days a week) working from a sub-30 5K toward a 10K and a half marathon. Every part of that profile can be changed to fit you (see [Make it yours](#make-it-yours)).

## What it does

| When | Where | What |
|---|---|---|
| Within ~2 hours of each run | `#run-log` | Coaching on that run: what it means, why it matters for your goal, and one next action. Judged against the day's planned workout. |
| Sunday evening (Pacific) | `#weekly-coach` | A recap of the week against the plan (distance, runs completed, long run, easy time, wins and warnings), plus next week's plan: all 7 days of runs, strength and yoga, with distance, HR ceiling and pace guide for every run. |

Each post has a color bar: 🟢 on track, 🟡 watch this, 🔴 back off.

## How it works

```
Your watch ────► its app/cloud ───► intervals.icu ──► running-coach (GitHub Actions)
                                                          │
                          metrics computed in code ◄──────┤  splits, HR drift, easy-zone time,
                                                          │  weekly ramp, VDOT training paces
                                                          ▼
                                                     Claude (via the claude CLI)
                                                          │  structured JSON, checked with Zod
                                                          ▼
                                                   Discord webhooks ──► #run-log / #weekly-coach
                                                          │
                                  Upstash Redis ◄─────────┘  posted runs, weekly plans
```

- **The numbers are computed in code, and Claude reasons over them.** Paces are labelled easy / moderate / threshold before Claude sees them, so it never has to compare pace numbers itself.
- **Plans are checked in code against training rules.** The rules are 3–4 runs a week, at least 2 upper-body and 1 lower-body day, no hard run next to leg day, runs of at least 1.5 mi, weekly mileage up about 10% at most, and the long run up at most 1 mi. A plan that breaks a rule is sent back to Claude once with the problems listed.
- **The plan adapts one week at a time.** Each Sunday's review compares what you did against what was planned and writes the following week.

Design decisions and their reasons are in [docs/design.md](docs/design.md).

## Why intervals.icu and not Strava?

Strava's API agreement prohibits using Strava data in AI applications, and Garmin's own API is only open to businesses. [intervals.icu](https://intervals.icu) is free, syncs from most watch platforms, gives you a personal API key for your own data, and its API terms allow this kind of use.

## Supported watches

Any watch whose runs reach intervals.icu **through a direct connection** should work. The coach only needs distance, time, heart rate and speed, which every GPS running watch records.

| Watch | How runs get into intervals.icu |
|---|---|
| Garmin | Direct connection to Garmin Connect. **Tested** (Forerunner 165). |
| COROS, Polar, Suunto, Amazfit, Huawei, Wahoo | intervals.icu lists integrations for these; use the direct connection where one is offered. Untested here. |
| Apple Watch | Through a bridge app such as HealthFit or RunGap. Untested here. |
| Anything else | Upload FIT files (manually or via Dropbox). Untested here. |

**Runs must not come in through Strava.** Activities that reach intervals.icu via Strava are blocked from its API, so the coach can't see them. If your watch only syncs to intervals.icu through Strava, it won't work.

To check your setup, open a recent run in intervals.icu and confirm its source is your watch's platform, not Strava. Then run `npm run coach -- spike` (step 7 below): your recent runs should all be listed. If it prints "Skipped N activities without usable data", those runs came in through Strava; reconnect your watch's platform directly.

Heart rate matters: the coach judges effort mainly by HR zones. A chest strap gives the cleanest data, but wrist HR works.

## Set it up for yourself

### What you need

- A **GPS running watch** whose runs sync to intervals.icu directly (see [Supported watches](#supported-watches))
- **Node.js 24+**
- For coaching, either:
  - a **Claude Pro or Max plan** and the [Claude Code CLI](https://code.claude.com) (recommended), or
  - a **Gemini API key** for a fully free setup, at your own risk (see [step 6](#6-coaching-model-claude-or-gemini))
- Free accounts on **intervals.icu**, **Discord**, **Upstash** and **GitHub**

With a Claude plan you already pay for, everything else runs on free tiers. With Gemini's free tier, it costs nothing at all.

### 1. Get the code

Fork this repo on GitHub (or create your own from it), then clone it:

```sh
git clone git@github.com:<you>/running-coach.git
cd running-coach
npm install
cp .env.example .env
```

Fill in `.env` as you go through the steps below. It's git-ignored, so never commit it.

### 2. intervals.icu (your run data)

1. Create an account at [intervals.icu](https://intervals.icu).
2. Under **Settings → Connections**, connect your watch's platform (e.g. Garmin Connect, COROS, Polar). Don't use Strava as the source (see [Supported watches](#supported-watches)).
3. Check that your recent runs appear.
4. Under **Settings → Developer Settings**, generate an API key and note your athlete ID.

```
INTERVALS_API_KEY=...
INTERVALS_ATHLETE_ID=...
```

The coach uses your intervals.icu heart-rate zones to decide what counts as easy (Z1–Z2). If your max HR or lactate threshold HR is known, set it in intervals.icu so the zones are right.

### 3. Your 5K time and time zone

Training paces (easy, threshold, interval) are calculated from a recent 5K race or time trial:

```
ATHLETE_5K_TIME=29:16.9
ATHLETE_TZ=America/Los_Angeles
```

### 4. Discord (where coaching is posted)

1. Create a private server: click **+** in the server list, then **Create My Own**, then **For me and my friends**.
2. Create two text channels: `run-log` and `weekly-coach`.
3. For each channel, open **Edit Channel → Integrations → Webhooks → New Webhook**, name it "Run Coach", and click **Copy Webhook URL**.

```
DISCORD_WEBHOOK_RUN_LOG=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_WEEKLY_COACH=https://discord.com/api/webhooks/...
```

Treat webhook URLs like passwords: anyone who has one can post to your channel.

### 5. Upstash (the coach's memory)

GitHub Actions starts from a clean machine on every run, so the coach keeps its state in a free Redis database: which runs it has already coached, and your weekly plans. It only stores summaries (distance, pace, HR), never GPS data.

1. Sign up at [console.upstash.com](https://console.upstash.com).
2. **Create Database** → Redis, free plan, a US East region.
3. From the **REST API** section, copy the URL and the regular (not read-only) token.

```
UPSTASH_REDIS_REST_URL=https://....upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

### 6. Coaching model: Claude or Gemini

| | Claude (default) | Gemini free tier (opt-in) |
|---|---|---|
| Cost | Included in a Claude Pro/Max plan | Free |
| Your data | Handled under your Claude plan's terms and your privacy settings | **Google may use it to improve its products, and human reviewers may read it** |
| Coaching quality | What the prompts were written and tested for | Untested; prompts were tuned for Claude |
| Setting | `COACH_BACKEND=cli` | `COACH_BACKEND=gemini` |

#### Option A: Claude (recommended)

Locally, coaching runs through your logged-in `claude` CLI, so no API key is needed. Check that it works:

```sh
claude --version
```

For GitHub Actions, create a long-lived token (valid for one year):

```sh
claude setup-token
```

Keep it for step 8. Coaching calls count toward your plan's usage limits, but at about 5 calls a week the impact is small.

#### Option B: Gemini free tier (at your own risk)

> [!WARNING]
> Under the [Gemini API terms](https://ai.google.dev/gemini-api/terms) for unpaid services, Google "uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies," and "human reviewers may read, annotate, and process your API input and output." You must be 18 or older. (Users in the EEA, Switzerland and the UK get paid-tier data protections even on the free tier.)
>
> What gets sent is your run summaries (dates, distances, paces, heart rate, splits, weekly totals) and your 5K time: no GPS, no name, no account details. It's still your health data. Only choose this if you're comfortable with those terms.

1. Create an API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Add it to `.env`:

   ```
   COACH_BACKEND=gemini
   GEMINI_API_KEY=...
   ```

The default model is `gemini-3.8-flash`; set `COACH_MODEL` to use another. On a paid Gemini plan, Google doesn't use your prompts or responses to improve its products.

### 7. Try it locally

```sh
npm run coach -- spike              # print metrics for your last 4 weeks
npm run coach -- poll --dry-run     # coach your latest run and print the post
npm run coach -- weekly --dry-run   # print this week's review and next week's plan
npm run coach -- preview            # post coaching for your latest run to #run-log
```

The first real `poll` coaches only your most recent run and marks older runs as done, so your history doesn't flood the channel.

### 8. Automate it with GitHub Actions

1. In your GitHub repo, go to **Settings → Secrets and variables → Actions** and add these repository secrets:

   | Secret | Value |
   |---|---|
   | `CLAUDE_CODE_OAUTH_TOKEN` | the token from `claude setup-token` (Claude option) |
   | `GEMINI_API_KEY` | your Gemini key (Gemini option only) |
   | `INTERVALS_API_KEY` | from step 2 |
   | `INTERVALS_ATHLETE_ID` | from step 2 |
   | `ATHLETE_5K_TIME` | from step 3 |
   | `DISCORD_WEBHOOK_RUN_LOG` | from step 4 |
   | `DISCORD_WEBHOOK_WEEKLY_COACH` | from step 4 |
   | `UPSTASH_REDIS_REST_URL` | from step 5 |
   | `UPSTASH_REDIS_REST_TOKEN` | from step 5 |

   **Using Gemini?** Also open the **Variables** tab and add a repository variable `COACH_BACKEND` = `gemini`. You can skip `CLAUDE_CODE_OAUTH_TOKEN`.

2. **If you forked the repo**, open the **Actions** tab and enable workflows. GitHub turns them off on forks by default.
3. Go to **Actions → Poll runs → Run workflow** to test it. A green run ending in "No new runs." means everything is connected.

After that it runs on its own:

| Workflow | Schedule |
|---|---|
| `poll-runs.yml` | Every 2 hours |
| `weekly-coach.yml` | Sunday evening Pacific time (Monday 02:00 UTC) |

Scheduled workflows only run from the default branch. Don't run **Weekly coach** by hand midweek: it would review the unfinished week and mark it done, and Sunday's post would be skipped.

If your time zone isn't Pacific, change `ATHLETE_TZ` in both workflow files and adjust the cron time in `weekly-coach.yml` so it fires on Sunday evening where you are.

## Make it yours

The runner profile lives in plain files, so adapting the coach to you is mostly editing text:

| What | Where |
|---|---|
| Goals, weekly schedule, training philosophy, tone | `prompts/post_run.md` and `prompts/weekly_review.md` |
| Rules every plan must pass (runs per week, strength days, ramp, minimum run length, leg-day spacing) | `src/plan/rules.ts` (tests in `test/plan.test.ts`) |
| Current phase and next milestone ("long run 6 mi") | `weekly()` in `src/cli.ts` |
| "Completed" threshold (75% of planned distance) | `src/plan/compare.ts` |
| Discord layout | `postRunEmbed` in `src/coach/postRun.ts`, `weeklyEmbeds` in `src/coach/weekly.ts` |

If you change the rules, update the prompts to match, so Claude plans within the same limits the code enforces.

## Commands

| Command | What it does |
|---|---|
| `npm run coach -- poll [--dry-run]` | Coach new runs and post to `#run-log`. `--dry-run` prints instead. |
| `npm run coach -- weekly [--dry-run] [--force]` | Review this week, post to `#weekly-coach`, and save next week's plan. `--force` re-posts a week already reviewed. |
| `npm run coach -- preview [--dry-run]` | Re-coach the latest run and post it without marking it done (for testing the format). |
| `npm run coach -- spike [weeks]` | Print recent run metrics locally. |
| `npm test` / `npm run typecheck` | Run the tests and type checks. |

## Privacy

This repo is meant to be public, so it's built to keep your data out of it:

- Secrets live only in `.env` (git-ignored) and GitHub Actions secrets.
- Workflow logs, which are public on public repos, only show activity IDs and token counts, never your pace, heart rate or distance.
- GPS data is never downloaded. The app only requests time, distance, heart rate and speed streams, and drops every activity field it doesn't use.
- Workflows only run on a schedule or when you trigger them by hand, never on pull requests, so forks can't reach your secrets.
- Discord posts name the recording device (e.g. "Garmin Forerunner 165"), which covers Garmin's attribution requirement. Garmin is the only brand whose data terms have been checked; if you use another brand, check its terms for AI use yourself.

## Project layout

```
src/
  cli.ts            commands: poll, weekly, preview, spike
  intervals/        intervals.icu API client
  metrics/          splits, HR drift, easy-zone time, weekly volume and ramp, VDOT paces
  plan/             week plan schema, training rules, planned vs actual
  coach/            Claude backend, post-run and weekly coaching, Discord layouts
  notify/           Discord webhook sender
  store/            Upstash Redis (posted runs, plans)
prompts/            coaching instructions for Claude
docs/design.md      decisions and reasoning
```

## Limitations

- **Proof of concept.** Coaching runs on a Claude subscription through the CLI (or on Gemini, if you opt in). For a long-term setup, the Claude API (about $2/month at this volume) can be added behind the same `CoachModel` interface in `src/coach/model.ts`.
- **Strength and yoga aren't tracked.** The coach plans them but can't see whether they happened.
- **Wrist heart rate is noisy.** HR drift is only calculated on runs of 25 minutes or more.
- **The setup token expires after a year.** Run `claude setup-token` again and update the secret.
