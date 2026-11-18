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

The schema is in `supabase/migrations/`: one file for the tables, constraints and the signup trigger, one for row level security (RLS), the rules that say which rows each user may read or write, one for onboarding (the completed flag, limits on profile data, the photo bucket and its policies), one for approving verifications in a single transaction, one that saves a weekly drop (`write_drop`), one for answering intros and opening chats (`decide_intro`), and one for conversations (`send_message`, `record_decision`, `expire_conversations`, the unread marker and realtime). There is no public browse of profiles: you can only read your own, or someone you were shown in an intro or are chatting with. Users cannot change their own `role`, Plus status or verification status, because those columns are not writable for them.

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

| Email                       | Who                   | What it shows                                                                                                                                                         |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priya@demo.shortlist.test` | Woman, Bengaluru      | A full shortlist of three, and a chat in progress                                                                                                                     |
| `arjun@demo.shortlist.test` | Man, Pune             | A chat with about 4 hours left where Sneha wrote and he has not replied (reminder banner; replying opens the day-3 decision), and a woman who already showed interest |
| `neha@demo.shortlist.test`  | New member, Hyderabad | A finished profile with nothing yet (the empty state)                                                                                                                 |
| `admin@demo.shortlist.test` | Admin                 | The admin dashboard and verification approvals                                                                                                                        |

The other demo members (for example `meera@`, `rohan@`, `lakshmi@` on the same domain) use the same password. To see onboarding, sign up with a new address.

The admin area is at `/admin`; a link appears on `/home` for admins. Admin is a role stored on the profile, and users cannot set it themselves. Access is checked on the server for every page and every action, not only in the middleware, and anyone who is not an admin gets a plain 404. The dashboard shows profile counts by eLitmus status and counts of logged events. The verification page lists pending requests with Approve and Reject. These use the service role, only change rows that are still pending, and write a row to `audit_log` (who, what, which profile) and an event. The status change and the audit row are written together by one database function (`admin_review_verification`, callable only by the server), so one can never happen without the other. Reject sets the status back to not requested and clears the stored pH ID hash so the person can try again. Admins see an age, never a birth date, and only whether a pH ID hash exists, never the hash.

To make a real account an admin, run this in the Supabase SQL editor: `update public.profiles set role = 'admin' where id = '<user id>';`

## Matching and the weekly drop

Once a week every member gets a short list of introductions: 3 for free members, 5 for Plus. Everything the engine uses (the numbers and the score weights) is in `config/matching.ts`; the engine itself is plain TypeScript in `lib/matching/` and does not touch the database.

How a drop is built, in plain words:

1. **Who takes part.** Paused, deleted, suspended and half-finished profiles are left out.
2. **Hard rules.** A candidate must be in the same city, both people must be interested in each other's gender, ages must be within 6 years (there is no age-range setting yet), the intents must be compatible, nobody has blocked anybody, and you have not been shown that person in the last 8 drops or already chat with them. These are never traded off against the score.
3. **Score** (0 to 1): 35% how many of the eight values questions you answered the same way (a question counts double if either person marked it as a deal-breaker), 20% shared interests, 15% pH batches close together, 10% intent, 10% how often the person replies (a band, and neutral until they have 5 chats), 10% a bonus for people who were rarely shown lately. Pairs under 0.30 are never shown, so a small pool gives fewer intros instead of weak ones.
4. **Assignment.** People take turns in a random order (the same seed gives the same order), each taking their best candidate who is not yet in 5 shortlists, until everyone has their quota or runs out of options. This is greedy, not optimal: the best possible assignment is a flow problem. I chose it because it is easy to explain and the loss is small when the cap (5) is bigger than the number of intros (3).
5. **Reasons.** Each intro gets two plain sentences from the strongest signals, for example "You answered alike on how close you stay to family". They name a topic, never an answer, and never use the birth date or exact age.

The drop is saved by a database function (`write_drop`, only the server can call it) in one transaction, so running a week twice never creates duplicates. A drop made by the seed script is marked as demo and is replaced; a real drop is left alone, and "rebuild" only works while nobody has answered an intro in it.

To run it:

- **From the admin area:** `/admin/drop`, button "Run drop now". It shows how many people were considered, how many intros were created, the share of people with at least one intro, how many shortlists the most and least shown person appear in, and why some people got none (counts only).
- **On a schedule:** `.github/workflows/weekly-drop.yml` calls `POST /api/cron/drop` every Sunday at 20:00 India time. It needs the repository secrets `APP_URL` (the deployed address) and `CRON_SECRET` (the same value as in the app's environment). If `CRON_SECRET` is not set, the endpoint refuses everything. `.github/workflows/keep-alive.yml` pings `/api/health` and `/api/cron/keepalive` (one tiny database query) every three days so a free Supabase project does not pause. `.github/workflows/expire-chats.yml` calls `POST /api/cron/expire` every hour (see Conversations below).
- **By hand:** `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/drop` (the reply has only totals, no personal data).

The seed script now also removes a drop for the two demo weeks before re-creating its demo drops, so you can run "Run drop now" and later seed again.

## Shortlist and opening a chat

Members see their weekly intros at `/shortlist` (linked from `/home`): the person's card, "why we matched", how many intros are left, a countdown to the end of the intro and to the next drop, and Pass or Interested with an optional note of up to 140 characters (no links, email addresses, phone numbers or handles; the check is `lib/validators/contact-info.ts`). Photos are signed with the member's own session, so the storage rules still apply. There are friendly empty states for no drop yet, nobody found this week, everything answered, intros that ended, and a paused profile. A "Second look" box is a disabled placeholder that says it comes with Plus. `/chat` lists your chats (see the next section).

The rules, all in `config/shortlist.ts`:

- **A chat opens only when both people said Interested** in each other, in the same drop. One side's interest alone never opens anything.
- **Woman-first:** in a man-woman pair the woman is the opener (she writes first). A man's interest stays quietly pending until she answers, and the screen only says "if it is mutual, a chat opens". It never says whether she passed, and a pass is silent. For other pairs (two women, two men, anyone with a non-binary person) there is no such rule: plain mutual interest opens the chat and whoever said Interested first writes first.
- **Cap:** at most 3 chats open at once (5 with Plus; "open" and "kept" both count), for both people. If you are at your cap you cannot say Interested (nothing is saved; you can still pass) and the screen explains why. If the other person is at their cap, your interest is saved with the same neutral message as "waiting", and the chat opens the next time either of you opens Shortlist or Chats with a free slot.
- **Window:** a new chat is open for 72 hours. An intro can be answered until the next drop (Sunday 20:00 India time); after that it counts as expired (the check happens when someone answers).

The answer is saved by one database function, `decide_intro`, in one transaction. It checks that the intro is yours, new and not expired, saves the answer, and opens the chat if the rules above allow. Two people are locked in a fixed order while it runs, so a double click, or both people answering at the same moment, gives exactly one chat (the unique "one live chat per pair" index is a second safety net) and a repeated call just returns the same chat. Only the server can call it (it uses the service role and takes the member id from the verified session); the pure TypeScript twin in `lib/shortlist/decide.ts` is tested against it case by case. Members can read only their own intro rows, so nobody can see the other side's answer.

Events logged (no personal data in them): `intro_viewed`, `intro_interested`, `intro_passed`, `conversation_opened`, `cap_blocked`.

After pulling this, apply the new migration with `npx supabase db push`.

## Conversations and closing a chat

`/chat` lists your chats: the other person's name, the last message, an unread marker, a countdown and a badge ("Your turn", "Waiting", "Time to decide", "Kept", "Closed kindly", "Time ran out"). A chat opens at `/chat/<id>`. The numbers are in `config/conversation.ts`; the rules, in one pure function, are in `lib/conversation/state.ts` (`nextState`), and the database functions in `supabase/migrations/20261118000007_conversations.sql` follow the same rules (a test runs 140 cases through both).

How a chat lives:

1. **Opener first.** A new chat is open for 72 hours. The opener (the woman in a man-woman pair) writes first; the other person cannot write until then. The opener can send up to 3 messages before the first reply, then has to wait.
2. **Reminder at 48 hours.** Whoever still owes the first message or the first reply sees a gentle in-app banner saying how long is left and that going quiet counts toward their reply rate.
3. **Day 3 decision.** Once both have written, and from 48 hours after the chat opened, each person chooses **Keep talking** or **Close kindly**. Both keep: the chat becomes a kept chat (no time limit, it keeps using a chat slot). Either closes: the chat ends at once and the other person sees one of four short, blame-free notes the closer picked from a list. Close is final; Keep can still be changed to Close until the other person decides. Nobody sees what the other chose unless the result is "kept" (the database does not let people read each other's choice).
4. **Time runs out.** If the 72 hours pass with no first message, no reply, or without both people deciding, the chat is "expired". One Keep on its own does not keep a chat.
5. **Reply rate.** Every time a chat leaves "open" (kept, closed or expired), each person who owed a message gets one more in `reply_rate_den`, and one more in `reply_rate_num` if they sent one. The opener always owes the first message; the other person owes a reply only if the opener wrote. Deciding is not part of it.
6. **Slots.** Kept chats count toward the cap of 3 (5 with Plus). Closed and expired chats free their slot, and matches that were waiting for it get another try.

Sending is limited to 8 messages a minute and 120 an hour per person across all chats, counted from the messages table itself (a serverless app has no memory to count in). Messages are cleaned (control and invisible characters removed, at most 1000 characters) and can only be written through the `send_message` database function, never inserted directly. The first message a person sends in a chat is checked for a link, email, phone number or handle: the screen asks "Are you sure? Keep early chats in the app", and if they send anyway the message is flagged for moderators (a flag people cannot read). The text of messages is never put in events or logs. The "Safety" button in a chat header is a placeholder until report and block are built.

Live updates use Supabase Realtime (a subscription to new messages in that chat; row level security means only the two people receive them). If the live connection is not up the browser checks for new messages every 4 seconds, and every 20 seconds as a safety net when it is. Your own messages appear at once and are confirmed by the server; a failed send shows "Not sent" with Try again. Unread markers are stored per person (`conversation_reads`) and the other person can never see them.

**Expiry job.** `POST /api/cron/expire` (bearer `CRON_SECRET`, the same check as the drop) ends chats whose time is up, updates reply rates and retries matches that were waiting for a slot. `.github/workflows/expire-chats.yml` calls it every hour. Calling it twice is harmless. It logs one event with counts only.

**Demo controls.** With `DEMO_CONTROLS=true` in the environment, a "Demo controls" panel appears at the bottom of a chat that involves a demo account. It moves the chat's clock forward (to 49 hours in, to 4 hours left, or to "time is up") so the reminder, the decision screen and expiry can be seen without waiting. The server refuses unless the setting is on, the chat involves a demo account (`app_metadata.demo`, set only by the seed script) and the caller is in the chat (or an admin). Leave it off everywhere real people sign up.

After pulling this, apply the new migration with `npx supabase db push`, and make sure the `messages` table has Realtime switched on (the migration adds it to the `supabase_realtime` publication; Database > Replication in the dashboard shows it).

## Current state

Sign-up, login, logout, password reset, onboarding, photo upload, profile editing, pause and the simulated eLitmus verification exist. The seed script and a first admin area (dashboard and verification approvals) exist. The matching engine and the weekly drop (admin button, scheduled call, stats) exist, and members can answer their shortlist, with the woman-first rule and the chat cap enforced in the database. A chat opens on mutual interest and members can message, decide on day 3, close kindly, and chats expire on a schedule. Report, block, deletion and payments do not exist yet. My product and engineering decisions are in `docs/decisions.md`, and third-party code is listed in `docs/credits.md`.
