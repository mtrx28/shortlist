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

| Command                                           | What it does                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                                     | Start the dev server                                                   |
| `npm run build`                                   | Production build                                                       |
| `npm run lint`                                    | ESLint                                                                 |
| `npm run typecheck`                               | TypeScript check, no output files                                      |
| `npm test`                                        | Run the unit tests once (Vitest)                                       |
| `npm run format`                                  | Format everything with Prettier                                        |
| `npm run seed`                                    | Create or refresh the demo users                                       |
| `npm run seed:reset`                              | Remove only the demo users                                             |
| `npm run test:integration`                        | Integration tests against the local Supabase stack (needs Docker)      |
| `npm run test:e2e`                                | Browser tests with Playwright (needs the stack and the app running)    |
| `npm run test:all`                                | Starts the local stack and the app, runs both suites, stops everything |
| `npm run stack:up` / `stack:reset` / `stack:down` | Start, rebuild or stop the local Supabase stack                        |

## Database and sign-in

The schema is in `supabase/migrations/`: one file for the tables, constraints and the signup trigger, one for row level security (RLS), the rules that say which rows each user may read or write, one for onboarding (the completed flag, limits on profile data, the photo bucket and its policies), one for approving verifications in a single transaction, one that saves a weekly drop (`write_drop`), one for answering intros and opening chats (`decide_intro`), and one for conversations (`send_message`, `record_decision`, `expire_conversations`, the unread marker and realtime). There is no public browse of profiles: you can only read your own, or someone you were shown in an intro or are chatting with. Users cannot change their own `role`, Plus status or verification status, because those columns are not writable for them.

Sign-in uses Supabase Auth (email and password, with a confirmation email). The 18+ check happens in the sign-up server action and again in a database trigger, so calling the API directly does not skip it. Sign-up also needs ticking the Terms and Privacy boxes; the version agreed to is stored with a timestamp. The `/terms` and `/privacy` pages are drafts I wrote for the demonstration (see "Safety, privacy and the legal pages" below).

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

| Email                        | Who                         | What it shows                                                                                                                                                         |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priya@demo.shortlist.test`  | Woman, Bengaluru            | A full shortlist of three, and a chat in progress                                                                                                                     |
| `arjun@demo.shortlist.test`  | Man, Pune                   | A chat with about 4 hours left where Sneha wrote and he has not replied (reminder banner; replying opens the day-3 decision), and a woman who already showed interest |
| `neha@demo.shortlist.test`   | New member, Hyderabad       | A finished profile with nothing yet (the empty state)                                                                                                                 |
| `ananya@demo.shortlist.test` | Woman, Bengaluru, with Plus | The Plus perks: 5 chats at once, 5 intros a drop, the full "why we matched" breakdown and a second look (re-seeding gives her a year of Plus; nobody else has it)     |
| `admin@demo.shortlist.test`  | Admin                       | The admin dashboard and verification approvals                                                                                                                        |

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

Sending is limited to 8 messages a minute and 120 an hour per person across all chats, counted from the messages table itself (a serverless app has no memory to count in). Messages are cleaned (control and invisible characters removed, at most 1000 characters) and can only be written through the `send_message` database function, never inserted directly. The first message a person sends in a chat is checked for a link, email, phone number or handle: the screen asks "Are you sure? Keep early chats in the app", and if they send anyway the message is flagged for moderators (a flag people cannot read). The text of messages is never put in events or logs. The safety menu in the chat header does report, block and, for a kept chat, "End this chat" (see below).

Live updates use Supabase Realtime (a subscription to new messages in that chat; row level security means only the two people receive them). If the live connection is not up the browser checks for new messages every 4 seconds, and every 20 seconds as a safety net when it is. Your own messages appear at once and are confirmed by the server; a failed send shows "Not sent" with Try again. Unread markers are stored per person (`conversation_reads`) and the other person can never see them.

**Expiry job.** `POST /api/cron/expire` (bearer `CRON_SECRET`, the same check as the drop) ends chats whose time is up, updates reply rates and retries matches that were waiting for a slot. `.github/workflows/expire-chats.yml` calls it every hour. Calling it twice is harmless. It logs one event with counts only.

**Demo controls.** With `DEMO_CONTROLS=true` in the environment, a "Demo controls" panel appears at the bottom of a chat that involves a demo account. It moves the chat's clock forward (to 49 hours in, to 4 hours left, or to "time is up") so the reminder, the decision screen and expiry can be seen without waiting. The server refuses unless the setting is on, the chat involves a demo account (`app_metadata.demo`, set only by the seed script) and the caller is in the chat (or an admin). Leave it off everywhere real people sign up.

After pulling this, apply the new migration with `npx supabase db push`, and make sure the `messages` table has Realtime switched on (the migration adds it to the `supabase_realtime` publication; Database > Replication in the dashboard shows it).

## Safety, privacy and the legal pages

**Report and block** are on every intro card and in every chat ("Safety" button). Blocking hides the two people from each other for good: neither can read the other's profile or photos, no chat can be written, the matching filter skips them, and any live chat between them ends at once and frees its slot for both (waiting matches are retried). A block is created only by the `block_user` database function (so the daily limit of 20 cannot be skipped). A report has a reason, optional details and an optional "include the last 20 messages" box. The messages are copied by the server from the real conversation, never sent by the browser, so evidence cannot be invented; admins cannot read chats otherwise, and opening a report's attached messages is written to the audit log. A report returns "we have your report, a person will acknowledge it within 24 hours" straight away; limits are 5 reports and 20 blocks a day, counted by the database. A chat both people kept can be ended with "End this chat" and one of the kind notes.

**Admin:** `/admin/reports` is the queue (age, an "overdue" flag against my own draft targets of 24 hours to acknowledge and 15 days to resolve, set in `config/safety.ts`), with Acknowledge, Action (optionally suspending the person) and Dismiss, each written to `audit_log` in the same transaction as the change. A suspended person is hidden everywhere, their chats end, and they see a page that explains it and still offers data export and deletion. `/admin/contact` lists messages from the contact form. The dashboard shows open reports and how many are past the targets.

**Account tools** (`/account/privacy`, `/account/export`, `/account/delete`): consents with their versions and dates (optional ones can be withdrawn; withdrawing the eLitmus consent also removes the verification), a JSON export that contains only your own data (never another person's name, photo or messages; three a day), and account deletion that asks for your password again and a typed word, removes the photo files and the database rows in one transaction, and keeps only a minimal safety record (a salted hash, a reason and a date) when a report against you was open or acted on. What is kept and removed is spelled out on the delete page and in `docs/decisions.md`.

**Pages:** Terms, Privacy, Community rules, Safety tips and a Grievance page with a contact form (rate limited) are linked from the footer. They are drafts for the demonstration and say so.

**Security headers** (`next.config.ts`): a Content Security Policy limited to this site, the Supabase host (including its realtime WebSocket) and Razorpay checkout, HSTS on https, no framing, `nosniff`, a strict referrer policy and a permissions policy. `script-src` still allows inline scripts because Next.js needs them without a per-request nonce; that trade-off is explained in the file.

## Plus and payments

Shortlist Plus (`/plus`) costs Rs 199 for 30 days or Rs 499 for 90 days, as a **one-time purchase**: it does not renew, no card or mandate is stored. Plus gives 5 chats open at once (3 free), 5 intros in the weekly drop (3 free), the full "why we matched" breakdown, and a **second look**: once every 30 days bring back one intro from the last four weeks that you passed on or let expire, for 72 hours (they are not told; a chat opens only if they had said Interested in that drop). Buying again while Plus is running adds the time after the current end date. When Plus ends nothing is deleted: open chats stay open, you just cannot open new ones past 3. What is **never** behind Plus (listed in `config/plans.ts` and enforced by a test): reporting and blocking, verification, data export and deletion, being in other people's shortlists, the 3 weekly intros, messaging, the grievance page. Prices are in paise in `config/plans.ts`; the browser only sends a plan name. Prices include 18% GST as a draft assumption (to be checked; invoices are not built).

**What is simulated and what is Razorpay.** Which one runs is chosen by the environment (`lib/payments/select.ts`):

| Setting                                                         | What runs                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| No Razorpay keys (the default), or `PAYMENT_PROVIDER=simulated` | A fake checkout page labelled SIMULATED. Nobody is charged and there is no card form. It signs and verifies exactly like the real path. |
| `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (`rzp_test_...`)    | Razorpay Checkout in test mode: orders are created through Razorpay's API, card entry happens in Razorpay's window, test cards only.    |
| Only one of the two keys                                        | An error ("payments are not set up correctly"), never a quiet fall-back to the fake checkout.                                           |
| A key starting `rzp_live_`                                      | Refused, unless `ALLOW_LIVE_PAYMENTS=true`. That switch is not for this submission; real money is out of scope.                         |

A **TEST MODE** ribbon is shown on every payment page in the first two cases. Demo accounts (only the seeded ones, and only while `DEMO_CONTROLS=true`) also get a "Grant me 30 days of Plus" button on `/plus`, so evaluators can try the perks without paying; it does not exist for real members.

**How a payment becomes Plus.** The server creates the order (price from config, member from the session) and stores an `orders` row. After paying, two things can arrive and either may come first: the browser callback (a server action that checks the signature `HMAC-SHA256(order_id|payment_id, key_secret)` with a constant-time compare) and Razorpay's webhook at `/api/webhooks/razorpay` (signature `HMAC-SHA256(raw body, webhook_secret)` over the exact bytes received). Both call one database function, `grant_plus`, callable only by the server: it locks the order, checks the member, the amount and the currency, marks it paid exactly once and adds the days. A second call (a replayed webhook, a double click, the callback after the webhook) answers "already granted" and changes nothing. A tampered signature, someone else's order, a wrong amount or an unknown order grants nothing. Users can read their own orders but cannot write orders or `plus_until`.

**Admin.** The dashboard has an orders block (orders, paid, not completed, paid total in test money, Plus members now, conversion = members who paid / active members) and `/admin/orders` lists the latest orders with masked ids (no card data exists anywhere to show). "Revoke Plus" ends someone's Plus and is written to the audit log. No refund is sent by the app: refund by hand in Razorpay's dashboard, then revoke. The draft Terms have a short refund paragraph.

**Setting up Razorpay test mode** (needs a free Razorpay account; no money is involved):

1. In the Razorpay dashboard switch to **Test Mode** and create API keys (Account and Settings > API keys). Put the key id (`rzp_test_...`) and secret in `.env.local` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Never commit them.
2. Add a webhook (Account and Settings > Webhooks) with the URL `https://<your-app>/api/webhooks/razorpay`, a secret of your choice (put the same value in `RAZORPAY_WEBHOOK_SECRET`) and the events `payment.captured`, `order.paid` and `payment.failed`. For local testing, expose your machine with a tunnel and use that address, or skip the webhook: the browser callback alone still grants Plus.
3. Restart the app, open `/plus`, choose a plan. In the Razorpay window use **Razorpay's published test card or test UPI details** from their documentation (search "Razorpay test card details" on razorpay.com/docs; I do not copy card numbers here). Success returns to `/plus/success`; failing a payment returns to `/plus/failed`.

Not verified against the real Razorpay: the Orders API call, the Checkout window, webhook delivery and the exact webhook payload shapes (parsed from Razorpay's documented format and covered by tests built from that format). That needs one test-mode payment with real test keys.

## Testing

There are three layers, from fast to realistic.

1. `npm test` (about 10 seconds, no Docker): unit tests and the database tests, which run every migration inside an in-process Postgres (PGlite) and act as different users.
2. `npm run test:integration`: real `supabase-js` clients against a real local Supabase stack (Postgres, auth, PostgREST, Realtime, Storage, mail catcher). It covers sign-up with the confirmation email, row level security from real clients, storage rules, the chat functions under true parallelism, Realtime delivery, the cron endpoints over HTTP, account deletion against real storage, and the seed script.
3. `npm run test:e2e`: Playwright drives the real app in Chromium (desktop and a phone-sized screen), including an accessibility check with axe-core on the key pages.

To run layers 2 and 3 you need Docker running. `npm run test:all` does everything: starts the stack, rebuilds its database from the migrations, builds and starts the app, runs both suites and stops it all (`--keep-stack` leaves the containers running). The settings of the local stack go into `.env.test.local` (written by `npm run stack:up`, git-ignored). The test tools read only that file and refuse to run if the Supabase address is not on this machine, so they can never touch the real project. The app for the tests is built into `.next-test`, separate from a normal build. A manually started GitHub workflow (`.github/workflows/e2e.yml`, also on pull requests to main) runs the same thing in CI.

To try the demo data on the local stack: `npm run stack:up`, `npm run seed:local`, then `npm run seed:local:reset` to remove it again.

## Current state

Sign-up, login, logout, password reset, onboarding, photo upload, profile editing, pause and the simulated eLitmus verification exist. The seed script and a first admin area (dashboard and verification approvals) exist. The matching engine and the weekly drop (admin button, scheduled call, stats) exist, and members can answer their shortlist, with the woman-first rule and the chat cap enforced in the database. A chat opens on mutual interest and members can message, decide on day 3, close kindly, and chats expire on a schedule. Report, block, the moderation queue, data export, account deletion, consent management and the draft policy pages exist and are covered by the integration and browser tests. Plus and payments exist (Razorpay test mode or a simulated checkout, a webhook, idempotent grants, an admin orders view); the real Razorpay API has not been exercised. My product and engineering decisions are in `docs/decisions.md`, and third-party code is listed in `docs/credits.md`.
