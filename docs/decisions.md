# Decision log

This is where I record the product and engineering decisions behind the app: what I considered, what I picked, and what I am giving up. The assignment says the reasoning matters more than the feature list, so the reasoning lives here, next to the code.

How to read an entry: Context (the problem), Options (with honest pros and cons), Decision, Why, Trade-offs and risks, and the questions I expect to be asked with short answers. Jargon is explained inline.

Status values: PROPOSED (drafted, not yet confirmed by me), ACCEPTED (I have thought it through and own it), SUPERSEDED (replaced, with a link to what replaced it). I update the status only after I have actually challenged the entry.

Facts about markets, laws and free-tier limits were checked at a point in time and are marked "verify" where I am not certain. I am not a lawyer; legal items are my reading of public sources and should be checked with a professional before a real launch.

---

## D1. What to build: Shortlist, a slow, capped, verified introduction app

Status: ACCEPTED

**Context.** eLitmus has 1M+ graduates from 2020-2023 batches, and the pH Test is a trusted identity for them. The brief says not to build a Tinder or Hinge clone. Public data suggests swipe apps are tiring users out: a Redseer analysis reports over 75% of Gen Z users in India feel swiping fatigue and that a swipe app lost paying users in Q3 2025 while serious-intent apps grew paying users; Bumble and Tinder paying users fell through 2025; Hinge itself announced a cap on simultaneous conversations because too many messages go unanswered. The pain is not "too few profiles", it is too many shallow ones, ghosting, fake profiles, and women getting flooded.

**Options considered.**
1. Shortlist: 3 curated introductions per week, no swiping, capped concurrent chats, time-boxed conversations that must end in "keep talking" or "close kindly".
   - Pros: attacks the real pain (volume, ghosting, flooding); demo-able in 10 minutes; each piece is simple to build; works with a small user base because the matching is curated, not infinite.
   - Cons: curated-intro apps exist (Coffee Meets Bagel did daily "bagels"); weekly cadence can feel slow in a demo, so I add an evaluator "run the drop now" control.
2. Saturday Plans: people post or join small real-world plans at partner venues.
   - Pros: strong monetization (venues pay), very different feeling, off-screen outcomes.
   - Cons: heavier safety story (meeting strangers in groups), needs local supply of venues, harder to demo with fake data.
3. Move-in: matching for freshers who relocated for a first job.
   - Pros: sharp segment, fits eLitmus (placement-driven migration).
   - Cons: it is a targeting choice more than a mechanic; I fold it into option 1 instead.
4. Vouched circles (friends or colleagues vouch for you).
   - Pros: strongest trust. Cons: cold-start nightmare, cannot be demoed without a real network.
5. Family-assisted "rishta-lite".
   - Pros: culturally relevant. Cons: privacy and consent complexity, and it drifts towards matrimony, which is a crowded, different market.

**Decision.** Option 1, aimed at the first-job generation (22-29, recently moved to a metro). Option 2 is the runner-up and becomes the Phase 2 "plan a first meet" feature.

**Why.** It scored best on the mix I care about: differentiation, use of eLitmus's actual assets (verified identity, cohort, city), buildable end to end in about ten days, and a clean ten-minute demo. The score table is in my private planning notes; the scores are judgment calls, not measurements.

**Trade-offs and risks.** A reviewer may say "this is Coffee Meets Bagel with a badge". My answer is on the next line. A smaller user base means fewer candidates, so match quality depends on good seed data and on launching in city and batch clusters.

**Likely questions.**
- *How is this not a clone?* No swipe, no infinite feed, hard caps on how many people you can talk to, and the app enforces an honest ending to every conversation. The unfair advantage is verified identity from a test people already took.
- *Why will people use it?* Because the alternatives cost them time and emotional energy, and women especially get a safer opening rule. I treat that as a hypothesis and list how I would test it.
- *What would you cut if time ran out?* Payments and admin dashboard, never safety or the core loop.

---

## D2. Verification: "Verified via eLitmus" as an honest, pluggable integration

Status: ACCEPTED

**Context.** The biggest asset is that eLitmus knows who these people are. But I do not have access to their database, and inventing a fake API would be dishonest.

**Options.**
1. Real-feeling but self-contained flow: the user enters their pH registration ID and verifies an email by OTP (a one-time code); an admin can approve a record; demo users arrive pre-verified. Document the production design: a signed single-sign-on token issued from the pH dashboard, verified by my server.
   - Pros: shows the idea working end to end, honest about what is simulated. Cons: the badge in my deployment is not backed by eLitmus data.
2. Email OTP only. Pros: simplest. Cons: throws away the differentiator.
3. Mock a pH API. Pros: looks impressive. Cons: dishonest, and I would not be able to defend it in the interview.

**Decision.** Option 1.

**Why.** The verification layer is the reason this product can exist only at eLitmus. I show it working, and say plainly which part is simulated and what the real integration would be.

**Trade-offs.** Anyone can type a made-up ID in my deployment; I state that clearly in the UI ("demo verification"). SMS OTP is skipped because in India it needs DLT registration (the telecom sender registration) and costs money.

**Likely questions.**
- *Is the badge real?* In production it would be, via a signed token from eLitmus; in this deployment it is a simulated check and labelled so.
- *Which pH data do you show?* Only a verified badge and graduation batch. I deliberately do not show the pH score: it would turn dating into a ranking and could stigmatise people.

---

## D3. Tech stack: Next.js + Supabase on Vercel

Status: ACCEPTED

**Context.** One person, about ten days, free hosting only, a live app evaluators will click through, and a repository I must be able to explain line by line.

**Options.**
1. Next.js (React framework, one codebase for pages and server code) in TypeScript + Supabase (hosted Postgres with built-in login, realtime, file storage, and row-level security) on Vercel.
   - Pros: least glue; realtime chat and auth come built in; RLS (rules inside the database saying who can read or write which row) is a strong security story; generous free tiers.
   - Cons: vendor coupling; free Supabase projects pause after a period of inactivity (verify the exact period; I plan a scheduled keep-alive ping); Vercel's free plan is for non-commercial use, fine for this assignment, not for a real business.
2. Next.js + SQLite/Turso + Auth.js with polling for chat.
   - Pros: fewer vendors, I write more of the auth logic myself. Cons: more code to write and secure; chat is clunkier.
3. Django or FastAPI + Neon Postgres + HTMX on Render.
   - Pros: simple mental model. Cons: Render free instances sleep and take around a minute to wake, a bad first impression for evaluators; more UI work.

**Decision.** Option 1.

**Why.** It minimises the code I need to get right under time pressure and gives me a realtime, secure-by-default foundation. The business logic that matters (matching, caps, conversation lifecycle) is plain TypeScript that I can test and explain.

**Trade-offs.** If Supabase changes its free tier I can move to plain Postgres because I use standard SQL. Keeping sensitive logic server-side and in RLS rather than in the browser costs a bit more setup.

**Likely questions.**
- *What is RLS and why trust it?* A database rule such as "a user can read messages only in conversations they belong to". Even if my app code has a bug, the database refuses. I test these rules with automated tests.
- *How does it scale?* Stateless web tier scales horizontally; Postgres scales vertically first, then read replicas; the weekly matching is a batch job that can be partitioned by city. Details in the architecture notes.

**As built for testing.** Beside the fast tests (unit tests and an in-process Postgres, `npm test`, no Docker) there is a real local backend for the things a simulation cannot prove: `npm run stack:up` starts the local Supabase stack in Docker (Postgres, auth, PostgREST, Realtime, Storage and a mail catcher), `npm run test:integration` uses real supabase-js clients against it (sign-up with the emailed link, row level security, storage rules, the chat functions under parallel connections, Realtime delivery, cron endpoints over HTTP, deletion against real storage) and `npm run test:e2e` drives the built app in Chromium with Playwright, including a phone-sized run and an accessibility check. The settings live in a git-ignored `.env.test.local` that the test tools read exclusively, and they refuse to run unless the Supabase address is on this machine. A manually triggered GitHub workflow runs the same suites. The pyramid is deliberate: most rules are pure functions or database functions with many cheap cases, a thinner layer proves the services work together, and a few long browser stories prove the screens do what the rules say.

---

## D4. Core mechanic: weekly intros, capped chats, kind closure, popularity cap

Status: ACCEPTED

**Context.** Swipe apps optimise for engagement, which creates volume without outcomes. I want to optimise for conversations that actually happen and end honestly.

**Options.**
1. Rule set: each user gets 3 intros a week (filtered by age, city, intent, then ranked by compatibility); at most 3 open conversations at once; a conversation has a 72-hour window to get a reply from both people; at the end each person chooses "keep talking" or "close kindly" (a polite template); no reply means it closes and a private reply-rate signal is recorded. No candidate is shown to more than 5 people a week (popularity cap).
   - Pros: fixes flooding, ghosting and gender-ratio pressure with simple rules I can explain. Cons: some users want more choice; rules need tuning with real data.
2. Daily intros with no concurrency cap. Cons: recreates overload.
3. Pure algorithmic "best match" without caps. Cons: the most attractive few get everything.

**Decision.** Option 1, with all numbers kept in one config file so they can be tuned.

**Why.** The rules are the product. They are cheap to build, deterministic, and testable in isolation. The popularity cap is a fairness choice: it spreads attention instead of concentrating it.

**Trade-offs.** The numbers (3, 3, 72h, 5) are my assumptions, not research results; I will say so and describe how to A/B test them.

**Likely questions.**
- *How does matching work?* Hard filters first, then a weighted score from values answers, interests, intent, and city; then a greedy assignment under capacity limits. Plain language walk-through in the README.
- *What happens to men who are never picked?* They still get 3 intros because intros are assigned from each user's side, not by popularity.

**As built for conversations.** The numbers live in `config/conversation.ts` and the rules in one pure function (`lib/conversation/state.ts`), mirrored by database functions that a test runs side by side. A chat has a 72 hour window and the opener writes first. The "day 3" decision opens 48 hours after the chat opened, and only once both people have written; before that people just chat. Both choose Keep: the chat is kept (no time limit, it still uses a chat slot). Either chooses Close kindly: it ends at once with a short blame-free note picked from four written by me. One Keep on its own does not keep a chat: if the other person never decides, it expires with everything else. When a chat ends (kept, closed or expired) each person who owed a message gets one more in their reply-rate denominator, and one more in the numerator if they sent one; the opener always owes the first message, the other person owes a reply only if the opener wrote. Deciding is deliberately not part of the reply rate, because a person who chatted but forgot to press a button did reply. I chose 72 hours because it spans a weekend or three working evenings, long enough for someone busy to answer and short enough that waiting does not turn into limbo; it is an assumption to tune, like the other numbers. The 3-chat cap is enforced because kept chats keep their slot, and a closed or expired chat gives its slot back and triggers a retry of matches that were waiting for it.

---

## D5. Monetization: pay for convenience and depth, never for safety or visibility

Status: ACCEPTED

**Context.** The brief says users do not want to pay. Benchmarks I found suggest about 1% of users on dating apps convert to paid, and paying bases are shrinking on swipe apps. eLitmus also does not want a product that exploits loneliness.

**Options.**
1. Free core. "Shortlist Plus" at Rs 199 a month (or Rs 499 for three months): 2 extra intros a week, 5 concurrent chats instead of 3, "why we matched" detail, one "second look" per month on a closed intro. Phase 2: B2B revenue from sponsored plans (cafes, events, employer community events) and a co-branded cohort programme.
   - Pros: no pay-to-be-seen or pay-to-message; consistent with the trust story. Cons: low conversion expected, so real money in phase 1 is small.
2. Venue/sponsor-only. Pros: users never pay. Cons: needs scale and sales effort; nothing to show in a live demo.
3. Pay-per-intro credits. Cons: pushes towards gambling-style mechanics.

**Decision.** Option 1.

**Why.** It matches what I believe people in this market will pay for (convenience, insight, a little more reach) without charging for basics like safety, verification or being visible. B2B is where I expect scale revenue, so I describe it but do not fake it.

**Trade-offs.** Honest numbers: at 2-4% conversion on a few thousand monthly users, revenue is tens of thousands of rupees a month, not a business yet. The value of phase 1 is proving retention and conversation rate, which unlocks the sponsor conversation.

**Likely questions.**
- *Why would anyone pay?* Because by week three the 3-chat cap is a real constraint for active users; Plus relaxes it.
- *Isn't capping then selling relief manipulative?* Plus only moves the caps modestly (3 to 5), and I do not sell access to a specific person or position in anyone's feed.
- *CAC and LTV?* Rough: near-zero CAC through owned channels, LTV about Rs 199 times an average of 3 paid months; all assumptions, listed in my plan.

---

## D6. Payments: Razorpay in test mode (fallback: clearly labelled simulated paywall)

Status: ACCEPTED

**Context.** A working product should show a working payment path, but I cannot take real money (no free-tier path, and KYC/business registration is out of scope).

**Options.**
1. Razorpay Checkout in test mode with server-created orders, signature verification, and a webhook; evaluators pay with a published test card.
   - Pros: real integration pattern, defendable security (never trust the browser's "paid" claim). Cons: needs a Razorpay account; roughly half a day.
2. Simulated paywall that grants Plus on click. Pros: fastest. Cons: reviewers may see it as fake.

**Decision.** Option 1, with the same internal interface so option 2 can be swapped in if needed.

**Why.** Payment correctness (idempotency, signature checks) is something I can speak to credibly, and test mode costs nothing.

**Trade-offs.** No real revenue; I state "test mode" on the paywall. In production: GST at 18% on digital services (verify), invoices, and RBI-compliant payment-aggregator terms handled by the gateway.

**Likely questions.** *Why not UPI intent?* Razorpay's checkout already offers UPI in test mode; going direct needs a merchant relationship. *How do you stop fake "I paid" calls?* The server verifies Razorpay's signature and only the webhook or verified callback upgrades the account.

---

## D7. Safety: women-first opening, report/block, rate limits, visible moderation

Status: ACCEPTED

**Context.** Women in India face harassment and scams on dating apps; fake profiles and extortion gangs are documented in news coverage. If women do not feel safe, the gender ratio collapses and the product fails.

**Options.**
1. Built-in rules: in a man-woman intro the woman's "interested" opens the chat; men get one short intro note; 18+ with date-of-birth check; verified badge; one-tap report and block available in every chat; blocked or reported users never reappear; message rate limits; hidden contact details (no phone numbers shared by the platform); an admin queue for reports with a 24-hour acknowledgement target.
   - Pros: covers the highest-risk behaviours at low cost. Cons: some men will find it unfair; same-sex and non-binary pairs need rules too (the rule is "the recipient of the intro opens the chat", decided by who is shown first).
2. Rely on after-the-fact moderation only. Cons: harm happens first.

**Decision.** Option 1.

**Why.** Safety is the product's trust engine and part of the legal duty of an intermediary.

**As built for the shortlist screen.** I made "women-first" mean two concrete things, not "her yes alone opens a chat". A chat opens only when both people said interested (same drop), so a man's interest alone never opens one and he never learns whether she passed. And in a man-woman pair the woman is the opener, so she writes first. For every other pair (two women, two men, anyone with a non-binary person) there is no woman-first rule: plain mutual interest opens the chat and whoever said interested first writes first. This replaces my earlier line "the recipient of the intro opens the chat", which does not work when both people are shown each other. The rule is a config switch (`womanOpens` in `config/shortlist.ts`). The 3-chat cap (5 with Plus) applies to both people; if I am at my cap I cannot say interested, and if the other person is at theirs my interest waits and the chat opens when a slot is free.

**As built for messages.** Nobody can insert a message directly: it goes through one database function that checks the person is in the chat, the opener-first rule (the opener can send three messages before a reply), the reply window, blocks, length (1000 characters), blank text and control characters, and a per-person rate limit (8 a minute, 120 an hour, counted from the messages table because a serverless server has no memory). The first message a person sends in a chat is checked for a link, email, phone number or handle: the screen asks "Are you sure? Keep early chats in the app", and if they send anyway the message is flagged for moderators. It is a soft warning, not a block, because a determined person can write a number in words and a hard block would only make honest people angry. People cannot read the flag, nor the other person's Keep or Close choice, nor each other's read markers; message text never goes into events or logs. Report and block, and the safety menu in the chat header, are still a labelled placeholder; they come next.

**As built for report, block and moderation.** (This replaces my sentence above that report and block were still a placeholder.) Blocking is one-way to set and two-way in effect: after a block neither person can read the other's profile or photos, no message can be sent, and the matching filter skips the pair. The block ends any live chat between them at once (status "blocked") and frees the slot for both, and the app retries matches that were waiting for a slot. It does not change anyone's reply rate, because a block says nothing about how responsive somebody was. A block is created only by a server-side database function, which counts blocks in the last 24 hours (20 at most) and refuses a person the blocker has no intro or chat with (the answer is the same as for a person who does not exist, so ids cannot be probed). A report has a reason from a fixed list, optional details (1000 characters) and an optional "include the last 20 messages" box. I designed the evidence so that nobody can forge it and nobody gets blanket access: the browser sends no message text; the server function checks that the reporter and the reported person are the two people in that conversation, copies the last 20 messages itself (labelled "reporter" and "reported", no names or ids) onto the report, and nothing is copied unless the box was ticked. Admins can list reports and read the reporter's words, but the evidence column is not readable by their own session at all; they open it one report at a time through a function that writes "report_evidence_viewed" to the audit log. Reports are limited to 5 a day per person, and a second report about the same person while the first is open returns the first. Moderation actions are atomic with their audit rows: acknowledge, action (optionally with a suspension) and dismiss. A suspension hides the profile everywhere, ends the person's live chats, stops them using the shortlist and chats (they land on a page that explains it and still offers data export, account deletion and the grievance page) and can be lifted by an admin. The queue shows each report's age and flags it when it is past my own draft targets (acknowledge within 24 hours, resolve within 15 days, in `config/safety.ts`); the interface does not claim these are legal deadlines. Either person can also end a kept chat with one of the kind notes.

**Trade-offs.** Moderation capacity in a live product needs people; in this deployment it is an admin page and written process. Automated text filters are limited to simple patterns (phone numbers, links) in the MVP.

**Likely questions.** *What if someone shares a number in chat?* It is allowed after consent but the platform warns first; the MVP flags pattern-based sharing in the first message. *How do you handle deepfake or fake photos?* Not solved in the MVP: verified identity helps, and I list photo liveness checks as future work.

---

## D8. Legal posture: 18+ only, minimal data, real deletion and export

Status: ACCEPTED (check with a lawyer before real launch)

**Context.** India's Digital Personal Data Protection Act 2023 and its Rules (notified November 2025, with obligations phasing in over roughly 18 months; verify the exact dates for each duty) apply to a dating app. The IT Rules 2021 apply to intermediaries.

**Options.**
1. Implement now what is cheap and visible: age gate (DOB, 18+ only, which also avoids the verifiable-parental-consent duty for children under 18), clear consent at signup with a versioned privacy notice, collect city rather than precise location, no phone number, in-app account deletion that actually deletes, JSON data export, a grievance officer page and a report flow with acknowledgement times, plus Terms and Privacy pages. Describe, but not build, the rest (data processor agreements, breach notification process, DPO, children's logic).
   - Pros: shows ownership of the legal question. Cons: documents are templates I wrote, not legal advice.
2. Only publish a policy page. Cons: a policy that the product does not follow is worse than none.

**Decision.** Option 1.

**Why.** The brief explicitly asks for legal implications; the best proof is that the product behaves the way the policy says.

**As built for deletion, export and consent.** Deleting an account asks for the password again (checked with a throw-away sign-in so the real session is untouched, with a limit of five wrong tries an hour) and a typed word. The photo files are removed from Storage first, then one database transaction does the rest, so a failure leaves the account intact and the routine can simply be repeated. What goes: the login, profile, consents, intros, blocks, the person's events and contact messages, and every chat they were in with all its messages, including the other person's side, because a chat cannot exist with one half (the delete page says so). What stays: payment records without the person's id (accounting); a report the person filed keeps its row without their id, and its words and evidence stay only while it is open, acknowledged or actioned (dismissed ones are scrubbed); reports about the person keep reason, status and dates but lose the reporter's words, the evidence copy and the admin note; the audit log keeps its rows but any "profile:<id>" of the deleted person is rewritten to a short hash. The only thing kept about the person is a safety record (a salted hash of their id, a reason and a time, no name and no content), and only when a report about them was open, acknowledged or actioned, or they were suspended, so deleting cannot be used to dodge moderation; a dismissed report leaves nothing. The salt is a server secret (`SAFETY_HASH_SECRET`, falling back to the pH hash secret); without one the routine refuses to run. Admin accounts cannot be deleted this way. The JSON export is built in the database and contains only the caller's own data: profile without internal columns (no role, no pH hash, no moderation times), consents, orders, their own events, the intros they were shown (their answer and note, not who the other person was), their chats (state and their own choice, not who the other person was), only the messages they wrote, reports they filed (their words, not the admin's note and not the evidence), and a count of blocks; it is limited to three a day and is a POST so another site cannot trigger it. Consents are an append-only history; the current answer is the newest row. The optional ones (eLitmus sharing, marketing) can be withdrawn on a page that states the effect first, and withdrawing eLitmus sharing also unlinks the verification in the same transaction. Terms and privacy cannot be withdrawn without leaving; a changed policy version shows a banner asking the person to accept the new text. The policy pages are drafts I wrote for the demonstration, marked as such; the draft grievance targets are mine and not a statement of what any rule requires.

**Trade-offs.** Deleting data permanently conflicts with keeping a safety record of reported users; I keep a minimal hashed safety record (reason, date, no content) and say so in the notice. This is a judgment I should have a lawyer review.

**Likely questions.** *Who is the data fiduciary (the DPDP term for the one deciding why and how data is processed)?* The operating company, for example eLitmus or a subsidiary; in this project, me as the author. *Do you share pH data?* Only after separate, explicit opt-in, and only the verified badge and batch year.

---

## D9. Hosting, free-tier survival and the evaluator experience

Status: ACCEPTED

**Context.** Evaluators will open the link cold. A sleeping or paused app, an empty app, or a broken login loses the game before it starts.

**Options.**
1. Vercel + Supabase, a scheduled keep-alive request (GitHub Actions cron), seeded demo users with published passwords, a guided "evaluator tour" page, and a "run this week's drop now" control for demo accounts.
2. Hope nobody notices the pause. Not acceptable.

**Decision.** Option 1.

**Why.** Reliability of the first five minutes matters more than any single feature.

**Trade-offs.** Published test passwords mean the demo environment must never contain real data; real signups on the same deployment are possible but clearly labelled as a demo.

**Likely questions.** *What if the DB pauses?* The cron ping prevents it and I document how to restore; the health endpoint reports status.

---

## D10. Naming and brand relationship to eLitmus

Status: ACCEPTED

**Context.** The pH Test is a hiring-trust brand. A dating product under the same name could dent trust, but it also benefits from it.

**Options.** (1) "Shortlist, by eLitmus" endorsement line; (2) fully separate brand; (3) eLitmus name in the product title.

**Decision.** Option 1, working name "Shortlist".

**Why.** Endorsement signals verified-people trust, while a separate name limits reputation spill-over. "Shortlist" ties to the hiring heritage and the small-list mechanic.

**Trade-offs.** The hiring metaphor could feel gimmicky or objectifying if overused, so the copy stays warm and avoids "candidate" language. The name is a placeholder and I may change it.

**Likely questions.** *Is a jobs company getting into dating a risk?* Yes: reputation, harassment complaints, privacy. Mitigations are in D7 and D8, and a separate brand with opt-in cross-promotion.
