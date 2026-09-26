# Design

Personal AI running coach. Pulls run data, computes coaching signals in code, has Claude reason over them, and posts coaching to a private Discord.

## Runner

- Current: 5K under 30:00
- Next: 10K, then half marathon
- Hybrid week: 3–4 runs + at least 3 strength days (2 upper, 1 lower/legs), with occasional yoga; hard runs placed away from leg day
- Device: Garmin Forerunner 165 (wrist HR)

## Data source

**Garmin Connect → intervals.icu → this app** (intervals.icu API, personal API key).

Why not Strava: Strava's API agreement (Nov 2024, §5.3) prohibits using Strava data "in connection with the development, training, evaluation, or operation of any AI Application", and Strava has not clarified whether single-user inference is allowed. The Strava MCP is meant for interactive chat use, not unattended jobs.

Why not Garmin directly: the Garmin Connect Developer Program is business-only.

Constraints from intervals.icu:
- Activities must sync to intervals.icu **from Garmin directly**. Activities that arrive via Strava are not available through the API.
- API terms allow any lawful use, but anything displayed that derives from Garmin data must credit Garmin (e.g. "Garmin Forerunner 165" in Discord footers).
- Rate limit: 5,000 requests/day with an API key (plenty).

## Decisions

| Area | Decision |
|---|---|
| Language / runtime | TypeScript, current Node LTS, run with `tsx` (no build) |
| Libraries | `@anthropic-ai/sdk`, Zod, Vitest; plain `fetch` for HTTP |
| Claude backend | PoC: Claude Pro plan via the `claude` CLI (local login; `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` in Actions). Structured output via `--json-schema`, tools and MCP disabled. Behind a `CoachModel` interface so the API can replace it after the PoC |
| Free alternative | Opt-in `COACH_BACKEND=gemini` (Gemini API via `fetch`, `responseJsonSchema` structured output) for a fully free setup. Not the default: on Gemini's free tier Google may use prompts/responses to improve its products and human reviewers may read them. Prompts are tuned for Claude; Gemini output quality is unverified |
| Scheduling | GitHub Actions: poll every ~2h + Sunday-evening PT weekly cron |
| State | Upstash Redis (REST) |
| Notifications | Discord webhooks: `#run-log`, `#weekly-coach` |
| Workout targets | Distance + HR zone as the primary target; pace range as a guide (tempo/intervals get pace ranges from the 5K) |
| Progression | Phases advance by gates (long-run milestones); an optional race date makes the plan work backward from it |
| Plan changes | Small changes auto-apply (repeat a week, ±mileage tweaks); phase changes or big cuts are posted as suggestions to approve |
| "Completed" run | ≥75% of planned distance = completed; less = partial (noted, not failed) |
| Weekly post | One Discord message, two embeds (recap + next week); split into two messages only if over Discord's 6000-char limit |
| Planning | Rolling weekly plan: each Sunday the coach reviews the week against its plan and writes next week (all 7 days: runs, strength, yoga), stored in Upstash. Code enforces the rules (3–4 runs, ≥2 upper + 1 lower, no hard run beside leg day, runs ≥1.5 mi, ramp ≤ max(+10%, +1.5 mi) over the recent peak week, long run ≤ recent longest +1 mi); a plan that breaks them is sent back once with the violations. A full phased plan can come later |

Wrist HR is fine for trends, but drift math skips the first 5 minutes (optical HR lag) and needs 20+ minutes after that; short-run HR swings of ±20 bpm at steady pace are sensor noise, not physiology.

## Privacy (public repo)

- No secrets in git; `.env` is ignored, `.env.example` has placeholders
- Never log tokens; mask runtime secrets with `::add-mask::` in Actions
- Store and send only aggregates (distance, time, pace, HR, splits). Never GPS tracks, maps, polylines or start coordinates
- `.state/` holds local-only data and is git-ignored

## Milestones

1. **Data spike:** pull the last 4 weeks from intervals.icu, print metrics locally
2. **Plan schema + generation:** Zod plan schema, first plan from Claude, sanity-check by hand
3. **Post-run coaching:** poll, match to planned workout, compute signals, post to `#run-log`
4. **Weekly review:** compare vs plan, adapt next 1–2 weeks, post to `#weekly-coach`
5. **Automation:** Actions workflows, secrets, Upstash state
6. **Later:** fatigue check-ins, stream overlay, possible Cloudflare Worker + webhooks
