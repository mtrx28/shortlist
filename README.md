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

| Command              | What it does                      |
| -------------------- | --------------------------------- |
| `npm run dev`        | Start the dev server              |
| `npm run build`      | Production build                  |
| `npm run lint`       | ESLint                            |
| `npm run typecheck`  | TypeScript check, no output files |
| `npm test`           | Run the unit tests once (Vitest)  |
| `npm run format`     | Format everything with Prettier   |
| `npm run seed`       | Create or refresh the demo users  |
| `npm run seed:reset` | Remove only the demo users        |

## Database and sign-in

The schema is in `supabase/migrations/`: one file for the tables, constraints and the signup trigger, one for row level security (RLS), the rules that say which rows each user may read or write, and one for onboarding (the completed flag, limits on profile data, the photo bucket and its policies). There is no public browse of profiles: you can only read your own, or someone you were shown in an intro or are chatting with. Users cannot change their own `role`, Plus status or verification status, because those columns are not writable for them.

Sign-in uses Supabase Auth (email and password, with a confirmation email). The 18+ check happens in the sign-up server action and again in a database trigger, so calling the API directly does not skip it. Sign-up also needs ticking the Terms and Privacy boxes; the version agreed to is stored with a timestamp. The `/terms` and `/privacy` pages are placeholders for now.

To use it with a real Supabase project: create a project, put its URL, anon key and service role key in `.env.local`, apply the migrations (`npx supabase link` then `npx supabase db push`), and in Authentication > Email templates set the confirm and reset links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (use `type=recovery&next=/reset-password` for the reset template). Without these variables the public pages still work and login says it is not set up.

## Onboarding, photos and verification

New users are sent from `/home` to `/onboarding`: five short steps (basics, eight values questions with two deal-breakers, three prompts, interests, photos). Every step is validated on the server with Zod and saved on its own, so someone who leaves halfway resumes at the first incomplete step. The question and prompt lists live in `config/`. The last step calls a database function that re-checks the profile is complete before it sets `onboarding_completed_at`; users cannot set that column themselves. Finished users are sent away from `/onboarding`. They can edit everything and pause their profile at `/account/profile`.

Photos go to a private Supabase Storage bucket (`profile-photos`), in a folder named after the user. The browser checks the type and size (JPEG, PNG or WebP, up to 5 MB, at most 4 photos), then shrinks and re-encodes each photo, which also removes EXIF data such as location, before uploading. Storage policies let only the owner write to their folder, and let someone read a photo only if they may see that profile (an intro or a conversation, no blocks). Photos are shown through signed links that expire after an hour.

eLitmus verification is a **simulation**. The form checks the pH ID format only, never looks anything up at eLitmus, and stores a keyed hash (HMAC) of the ID, never the ID. Because users cannot write `elitmus_status` themselves, the server action does it with the service role after checking the request. The status becomes `pending`; with `DEMO_AUTO_VERIFY=true` on the server it becomes `verified` immediately. Leave that unset in production. The "Verified via eLitmus" badge shows only when the status is `verified`. The pH score is never asked for or shown.

Extra settings for this: `ELITMUS_HASH_SECRET` (any long random string) and optionally `DEMO_AUTO_VERIFY`, see `.env.example`. After pulling these changes, apply the new migration with `npx supabase db push`.

The RLS tests run the migrations in an in-process Postgres (PGlite) and act as different users, so `npm test` covers them without Docker. They also run the onboarding migration, including the photo storage policies, against a small stand-in for Supabase Storage. They do not test Supabase's own auth service, realtime, or the real Storage service (uploads, signed links); that needs a real project.

## Demo data and the admin area

`npm run seed` creates 19 invented demo members and one demo admin, in Bengaluru, Pune, Hyderabad and Gurugram / Noida. They have complete profiles, simple generated avatar photos, a mix of verified, pending and not-requested eLitmus status, and ready-made states: a shortlist, chats in progress, a chat close to its 72 hour limit, a kept chat, a kindly closed chat, an expired chat and one open report. Everyone is fictional. The script needs these in `.env.local`: the Supabase URL, `SUPABASE_SERVICE_ROLE_KEY` and `DEMO_PASSWORD` (the shared password for every demo login; it is never stored in the repo). Run it after the migrations are applied.

- It is safe to run again: existing demo users are updated, and the chats, intros and events are rebuilt so the clocks (for example "4 hours left") are fresh.
- It refuses to run when `NODE_ENV=production` unless you add the flag: `npm run seed -- --force-demo`.
- Demo accounts use emails ending in `@demo.shortlist.test` and are flagged in `app_metadata`. `npm run seed:reset` deletes only accounts that have both marks, together with their photos and data. Real sign-ups are never touched.
- The seeded intros and chats are written straight into the tables, because the screens that create them come in later milestones. The two drops are for the current and the previous week.

Demo logins (the password is the value of `DEMO_PASSWORD`):

| Email                       | Who                   | What it shows                                                          |
| --------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `priya@demo.shortlist.test` | Woman, Bengaluru      | A full shortlist of three, and a chat in progress                      |
| `arjun@demo.shortlist.test` | Man, Pune             | A chat near its 72 hour limit, and a woman who already showed interest |
| `neha@demo.shortlist.test`  | New member, Hyderabad | A finished profile with nothing yet (the empty state)                  |
| `admin@demo.shortlist.test` | Admin                 | The admin dashboard and verification approvals                         |

The other demo members (for example `meera@`, `rohan@`, `lakshmi@` on the same domain) use the same password. To see onboarding, sign up with a new address.

The admin area is at `/admin`; a link appears on `/home` for admins. Admin is a role stored on the profile, and users cannot set it themselves. Access is checked on the server for every page and every action, not only in the middleware, and anyone who is not an admin gets a plain 404. The dashboard shows profile counts by eLitmus status and counts of logged events. The verification page lists pending requests with Approve and Reject. These use the service role, only change rows that are still pending, and write a row to `audit_log` (who, what, which profile) and an event. Reject sets the status back to not requested and clears the stored pH ID hash so the person can try again. Admins see an age, never a birth date, and only whether a pH ID hash exists, never the hash.

To make a real account an admin, run this in the Supabase SQL editor: `update public.profiles set role = 'admin' where id = '<user id>';`

## Current state

Sign-up, login, logout, password reset, onboarding, photo upload, profile editing, pause and the simulated eLitmus verification exist. The seed script and a first admin area (dashboard and verification approvals) exist. Matching, chat and payments do not yet. My product and engineering decisions are in `docs/decisions.md`, and third-party code is listed in `docs/credits.md`.
