# running-coach

Personal AI running coach. Garmin run data (via intervals.icu) → computed training signals → coaching from Claude → private Discord (`#run-log` after each run, `#weekly-coach` on Sundays).

See [docs/design.md](docs/design.md) for decisions and architecture.

## Setup

```sh
npm install
cp .env.example .env   # fill in values
npm run coach -- <command>
```

## Commands

- `npm run coach -- weekly [--dry-run] [--force]`: review this week vs its plan, post to `#weekly-coach`, and save next week's plan (`--force` re-posts a week already reviewed)
- `npm run coach -- spike [weeks]`: print recent run metrics locally
- `npm run coach -- poll [--dry-run]`: coach new runs and post to `#run-log` (`--dry-run` prints instead of posting)
- `npm run coach -- preview [--dry-run]`: re-coach the latest run and post it without marking it posted (for testing the format)

## GitHub Actions secrets

`CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `ATHLETE_5K_TIME`, `DISCORD_WEBHOOK_RUN_LOG`, `DISCORD_WEBHOOK_WEEKLY_COACH`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

