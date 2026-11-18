# Deploying Shortlist

These are the exact steps I follow to put the app on the internet: a Supabase project for the database, auth and photos, Vercel for the Next.js app, and GitHub Actions for the scheduled jobs. Everything here is on a free plan. Where a limit is something I read and have not tested, it says "verify".

Order matters: database first, then the app, then the schedules, then the checks.

## What you need

- A GitHub repository with this code (the scheduled jobs run there).
- A Supabase account and a Vercel account (both free, sign in with GitHub).
- Optional: a Razorpay account in **Test Mode** (free, no money moves) and an SMTP provider for email (Brevo or Resend free plans work).
- Node.js 20+ on your own machine to run the migrations and the checks.

## 1. Create the Supabase project

1. In Supabase, create a new project. Pick the region closest to your users (Mumbai, `ap-south-1`, if it is offered). Save the database password somewhere safe.
2. When it is ready, open **Project settings > API** and note three values: the project URL, the `anon` key and the `service_role` key. The service role key skips all database rules, so it only ever goes into server settings, never into the browser and never into git.
3. Apply the database schema from your machine:

```bash
npx supabase login
npx supabase link --project-ref <your project ref>
npx supabase db push
```

`db push` applies every file in `supabase/migrations/` in order (there are twelve). Run it again after pulling new migrations. If it asks about a mismatch with the remote history on a brand-new project, answer no changes are needed; the project is empty.

4. In the dashboard, check **Database > Replication**: the `messages` table should be in the `supabase_realtime` publication (the conversations migration adds it). Without it chats still work through the 4 second polling fallback, only slower.
5. Check **Storage**: a private bucket called `profile-photos` exists (created by the onboarding migration).

## 2. Set up sign-in emails (Supabase Auth)

1. **Authentication > URL Configuration**
   - **Site URL**: your final address, for example `https://shortlist.vercel.app` (no trailing slash). Confirmation and reset emails build their links from it.
   - **Redirect URLs**: add `https://<your domain>/**`. If you want Vercel preview deployments to work too, also add `https://*-<your-vercel-team>.vercel.app/**`. Leave `http://localhost:3000/**` in the list if you also develop locally.
2. **Authentication > Email Templates**: set the **Confirm signup** link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and the **Reset password** link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`.
3. **Authentication > SMTP Settings**: add a custom SMTP provider. Supabase's built-in sender is limited to a few emails an hour (verify the current number) and only sends to your team's own addresses on some plans, so a stranger signing up would not get a confirmation email. The demo logins do not need email at all; only fresh sign-ups do.
4. Optional, demo only: if you cannot set up SMTP, you can switch off **Confirm email** under Authentication > Providers > Email. Sign-ups then work without email, but the app still shows its "check your email" page afterwards (go to `/home`), and the email-verified step is skipped. I have not tested this combination. Do not do it for a deployment with real members.

## 3. Create the Vercel project

1. In Vercel: **Add New > Project**, import the GitHub repository. The framework is detected as Next.js; the defaults (`npm install`, `npm run build`) are right. No `vercel.json` is needed: the scheduled jobs run from GitHub Actions, because the Hobby plan limits Vercel's own cron to once a day (verify), which is not enough for the hourly expiry job.
2. Before the first deploy, add the environment variables below (**Settings > Environment Variables**, tick Production and Preview). Values starting `NEXT_PUBLIC_` are baked into the build, so after changing one you must **redeploy**.

| Variable                                 | Required?     | Value and where to get it                                                                                                                                                           |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`               | yes           | Supabase > Project settings > API > Project URL.                                                                                                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`          | yes           | Same page, the `anon` public key.                                                                                                                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`              | yes           | Same page, the `service_role` key. Server only. Never give it a `NEXT_PUBLIC_` name.                                                                                                |
| `NEXT_PUBLIC_APP_URL`                    | yes           | The final address, for example `https://shortlist.vercel.app`. Used in email links and link previews. If you forget it, the Vercel production domain is used instead.               |
| `CRON_SECRET`                            | yes           | A long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The scheduled jobs send it; with no value every cron endpoint refuses everything. |
| `ELITMUS_HASH_SECRET`                    | yes           | Another long random string (same command). Keys the hash of pH IDs. Never change it later: old hashes would stop matching.                                                          |
| `SAFETY_HASH_SECRET`                     | recommended   | Another random string (16+ characters) for the minimal safety record kept after a reported person deletes their account. If empty, `ELITMUS_HASH_SECRET` is used.                   |
| `DEMO_PASSWORD`                          | only to seed  | The shared password for the demo logins. Needed on your machine when you run the seed, not on Vercel.                                                                               |
| `DEMO_PASSWORD_PUBLIC`                   | optional      | Same value as `DEMO_PASSWORD`, if you want `/demo` to print it. Leave empty and `/demo` says "see the submission form / README".                                                    |
| `DEMO_CONTROLS`                          | optional      | `true` shows the demo clock panel on chats with demo accounts and the "Grant me Plus" button. Only for a deployment with invented members. Off unless exactly `true`.               |
| `DEMO_AUTO_VERIFY`                       | optional      | `true` approves pH ID requests straight away. Leave unset on a real deployment.                                                                                                     |
| `PAYMENT_PROVIDER`                       | optional      | Leave empty. Razorpay is used when both keys are set, the fake checkout when neither is.                                                                                            |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | optional      | Razorpay dashboard, **Test Mode**, Account and Settings > API keys. The id starts `rzp_test_`. Set both or neither.                                                                 |
| `RAZORPAY_WEBHOOK_SECRET`                | with Razorpay | The secret you type when you create the webhook (step 7).                                                                                                                           |
| `ALLOW_LIVE_PAYMENTS`                    | never         | Keep `false` or unset. A `rzp_live_` key is refused unless this is exactly `true`; real money is out of scope.                                                                      |

Without Razorpay keys the Plus checkout is a clearly labelled fake page, which is a fine choice for the submission. Do not set only one of the two keys: the app reports a configuration error rather than guessing.

3. Click **Deploy**. When it finishes, open the address Vercel gives you. If you want a different domain, add it under **Settings > Domains**, then update `NEXT_PUBLIC_APP_URL` and the Supabase Site URL and redeploy.

## 4. Make your own admin account

The seed creates `admin@demo.shortlist.test`, which is a demo account. For a real admin: sign up with your own email, confirm it, then in the Supabase SQL editor run:

```sql
update public.profiles set role = 'admin' where id = '<your user id>';
```

You can copy the user id from Authentication > Users.

## 5. Load the demo data (carefully)

The seed creates 19 invented members and an admin, all with emails ending `@demo.shortlist.test`, and removes nothing that is not marked as demo. I run it from my own machine, once, pointed at the production project:

1. Put the production Supabase URL, the service role key and a `DEMO_PASSWORD` in `.env.local` (this file is git-ignored; never paste these into a terminal history or a chat). If `.env.local` is also what you use for local development, back it up first and restore it afterwards.
2. Run `npm run seed`. It refuses to run without `DEMO_PASSWORD` (8+ characters), and it never prints a key or the password.
3. Check the output ends with the number of demo members, then open `/demo` on the deployed site and log in as `priya@demo.shortlist.test`.
4. Switch `.env.local` back to your local values.

Safe habits: seed before anyone real signs up if you can; `npm run seed:reset` removes only accounts that carry **both** the demo email domain and the demo marker, so it cannot delete a real member; the weekly drop replaces the seeded "this week" drop, so re-run `npm run seed` to restore the scripted demo state after an admin "Run drop now". Do not seed a deployment that holds real members' data unless you are sure it is what you want.

## 6. Turn on the schedules (GitHub secrets)

In the GitHub repository: **Settings > Secrets and variables > Actions > New repository secret**. Add two:

- `APP_URL`: the deployed address, with no trailing slash, for example `https://shortlist.vercel.app`.
- `CRON_SECRET`: exactly the same value as `CRON_SECRET` in Vercel.

Three workflows use them (`.github/workflows/`):

| Workflow       | When                    | What it calls                                                                                              |
| -------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `weekly-drop`  | Sunday 20:00 India time | `POST /api/cron/drop`: builds this week's introductions.                                                   |
| `expire-chats` | every hour              | `POST /api/cron/expire`: ends chats whose 72 hours are over.                                               |
| `keep-alive`   | every three days        | `GET /api/health` and `POST /api/cron/keepalive`: one tiny query so a free Supabase project is not paused. |

Each fails with a red error that names the missing secret if `APP_URL` or `CRON_SECRET` is not set, so a forgotten secret cannot go unnoticed. Run each once by hand (**Actions > the workflow > Run workflow**) and check it is green. GitHub may start scheduled runs a few minutes late, and it disables scheduled workflows in a repository with no activity for 60 days (verify), so re-enable them if that happens.

## 7. Razorpay test webhook (optional)

Skip this if you use the fake checkout.

1. Razorpay dashboard, **Test Mode**: **Account and Settings > Webhooks > Add new webhook**.
2. URL: `https://<your domain>/api/webhooks/razorpay`.
3. Secret: any long random string; put the same value in Vercel as `RAZORPAY_WEBHOOK_SECRET`.
4. Events: `payment.captured`, `order.paid`, `payment.failed`.
5. Redeploy, open `/plus`, pick a plan and pay with one of Razorpay's published test cards (search "Razorpay test card details" on razorpay.com/docs). A successful payment lands on `/plus/success`. The browser callback grants Plus even if the webhook never arrives; the webhook is the backup and is safe to receive twice.

## 8. Check it

```bash
npm run smoke -- https://<your domain>
```

It checks `/api/health`, `/`, `/demo`, `/terms`, `/privacy`, the manifest, that a signed-out visitor to `/shortlist` is sent to login, that all three cron endpoints answer 401 without the right secret, and the security headers (including HSTS and the https upgrade on https). Add `CRON_SECRET=<value>` in your shell to also prove the keep-alive job reaches the database, and `SMOKE_EMAIL` plus `SMOKE_PASSWORD` to log in through the real form in a headless browser (run `npx playwright install chromium` once first). It reads and refuses; it never writes data.

If a Razorpay test payment shows a blank window or a Content Security Policy error in the browser console, note which host was blocked and add it in `lib/security-headers.ts` (Razorpay does not publish one official list, so the hosts there come from how Checkout behaves and need confirming with one real test payment).

## Post-deploy checklist

- [ ] `npm run smoke -- <url>` passes.
- [ ] `/` shows the landing page; `/demo` shows the guide and the logins.
- [ ] Log in as `priya@demo.shortlist.test`: shortlist has three cards, one chat opens.
- [ ] Log in as `admin@demo.shortlist.test`: the dashboard cards load (if they say the metrics are not available, the latest migration has not been applied).
- [ ] A new sign-up receives a confirmation email and the link lands on `/home` (needs SMTP).
- [ ] Plus checkout completes (fake checkout, or a Razorpay test payment) and the page shows Plus.
- [ ] The three GitHub workflows have each run once by hand and are green.
- [ ] Browser console on the deployed site shows no Content Security Policy errors on `/`, `/demo`, `/shortlist`, `/chat/...` and `/plus`.
- [ ] `DEMO_AUTO_VERIFY` and `DEMO_CONTROLS` are set the way you intend (on only for a demo deployment).
- [ ] No secret appears in the repository: `git grep -n "service_role\|rzp_" -- . ':!docs' ':!.env.example'` finds nothing that is a real value.
- [ ] The published demo password (submission form, or `DEMO_PASSWORD_PUBLIC`) works.

## When something breaks

- **The site loads but login says "not set up"**: the two `NEXT_PUBLIC_SUPABASE_*` variables are missing in the Vercel build. Add them and redeploy.
- **Confirmation link goes to localhost**: `NEXT_PUBLIC_APP_URL` or the Supabase Site URL is wrong.
- **A workflow fails with 401**: `CRON_SECRET` differs between GitHub and Vercel. Update one and redeploy.
- **Supabase paused the project**: restore it from the dashboard; the keep-alive workflow exists to prevent this, so check that it has been running.
- **The cron endpoints time out**: the Hobby plan limits how long a function may run (verify the current limit). The drop and expiry jobs are small at demo scale; at real scale they would move to a worker.
