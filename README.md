# Shortlist

Shortlist is a slow dating app for people verified through eLitmus: three curated introductions a week instead of an endless feed. This is my submission project, and it is still being built.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # fill in values later; not needed yet
npm run dev
```

Open http://localhost:3000. The health check is at http://localhost:3000/api/health.

## Scripts

| Command             | What it does                      |
| ------------------- | --------------------------------- |
| `npm run dev`       | Start the dev server              |
| `npm run build`     | Production build                  |
| `npm run lint`      | ESLint                            |
| `npm run typecheck` | TypeScript check, no output files |
| `npm test`          | Run the unit tests once (Vitest)  |
| `npm run format`    | Format everything with Prettier   |

## Current state

Only the project skeleton exists: a placeholder landing page, a health endpoint, tests and CI. No sign-up, matching or chat yet. My product and engineering decisions are in `docs/decisions.md`, and third-party code is listed in `docs/credits.md`.
