# running-coach

Personal AI running coach. Garmin run data (via intervals.icu) → computed training signals → coaching from Claude → private Discord (`#run-log` after each run, `#weekly-coach` on Sundays).

See [docs/design.md](docs/design.md) for decisions and architecture.

## Setup

```sh
npm install
cp .env.example .env   # fill in values
npm run coach -- <command>
```
