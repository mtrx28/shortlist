# Shortlist

Shortlist is a slow dating app for people verified through eLitmus: three curated introductions a week instead of an endless feed. This is my submission project, and it is still being built.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # Supabase values are only needed for sign-up and login
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

## Database and sign-in

The schema is in `supabase/migrations/`: one file for the tables, constraints and the signup trigger, one for row level security (RLS), the rules that say which rows each user may read or write. There is no public browse of profiles: you can only read your own, or someone you were shown in an intro or are chatting with. Users cannot change their own `role`, Plus status or verification status, because those columns are not writable for them.

Sign-in uses Supabase Auth (email and password, with a confirmation email). The 18+ check happens in the sign-up server action and again in a database trigger, so calling the API directly does not skip it. Sign-up also needs ticking the Terms and Privacy boxes; the version agreed to is stored with a timestamp. The `/terms` and `/privacy` pages are placeholders for now.

To use it with a real Supabase project: create a project, put its URL, anon key and service role key in `.env.local`, apply the migrations (`npx supabase link` then `npx supabase db push`), and in Authentication > Email templates set the confirm and reset links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (use `type=recovery&next=/reset-password` for the reset template). Without these variables the public pages still work and login says it is not set up.

The RLS tests run the migrations in an in-process Postgres (PGlite) and act as different users, so `npm test` covers them without Docker. They do not test Supabase's own auth service or realtime; that needs a real project.

## Current state

Sign-up, login, logout, password reset and the schema exist. Onboarding, matching, chat and payments do not yet. My product and engineering decisions are in `docs/decisions.md`, and third-party code is listed in `docs/credits.md`.
