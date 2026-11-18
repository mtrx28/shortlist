import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/landing/section";
import { buttonVariants } from "@/components/ui/button";
import { CONVERSATION_CONFIG } from "@/config/conversation";
import { MATCHING_CONFIG } from "@/config/matching";
import { FREE_LIMITS, PLANS, PLUS_PERKS, formatRupees } from "@/config/plans";
import { SHORTLIST_CONFIG } from "@/config/shortlist";

// Signed-in members never see this page: the middleware sends them to /home.
// It has no data of its own, so it is built once and served as a static page.
// The numbers come from the same config files the rules run on, so the copy
// cannot drift from what the app does.

const title = "Shortlist: three introductions a week, not three hundred";
const description =
  "A slow dating app for first-job migrants aged 22 to 29, verified through eLitmus. Three curated introductions a week, a cap on open chats, a 72 hour reply window and an honest way to end a conversation.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, url: "/", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

const rules = [
  {
    head: `${FREE_LIMITS.introsPerDrop} introductions a week`,
    body: "Every Sunday at 8 pm India time you get a short list, each with the reasons we matched you. No feed, no swiping, nothing to refresh.",
  },
  {
    head: `${FREE_LIMITS.chatCap} chats at once`,
    body: "You can have at most three conversations open. A cap makes you pick people on purpose, and it means a reply is worth sending.",
  },
  {
    head: `${SHORTLIST_CONFIG.windowHours} hours to reply`,
    body: "A new chat is open for three days. If nobody writes, it ends by itself, so you are never left wondering whether a silence is a no.",
  },
  {
    head: "Day 3: keep or close, kindly",
    body: `From hour ${CONVERSATION_CONFIG.decisionOpensAfterHours}, once you have both written, each of you chooses Keep talking or Close kindly. Closing sends a short note that blames nobody. Nobody sees your choice unless you both keep.`,
  },
  {
    head: "Women write first",
    body: "In a woman-man pair the woman opens the chat. A man's interest waits quietly until she answers, and a pass is never announced to anyone.",
  },
  {
    head: `Shown in at most ${MATCHING_CONFIG.maxShortlistsPerCandidate} shortlists`,
    body: "No one can appear in more than five people's shortlists in a week, so a few popular profiles do not collect everyone's attention.",
  },
];

const trust = [
  {
    head: "Verified, not scored",
    body: "You can verify with your pH ID to earn a badge. The app shows the badge and your batch year. It never asks for your pH score and never shows one.",
  },
  {
    head: "Consent you can see",
    body: "You must be 18 or older. What you agreed to, and when, is on your privacy page. The eLitmus link is a separate, optional consent that you can withdraw.",
  },
  {
    head: "Block and report on every card and chat",
    body: "Blocking hides you from each other for good and ends any open chat. A person reads every report, and the queue shows how long each has waited.",
  },
  {
    head: "Yours to take or delete",
    body: "Download your data as a file, or delete your account yourself. Photos, messages and profile go. Only a minimal safety record stays if you were reported.",
  },
];

export default function LandingPage() {
  return (
    <div className="space-y-16">
      <section className="space-y-6" aria-labelledby="hero-title">
        <p className="text-primary text-sm font-medium">
          For people verified through eLitmus
        </p>
        <h1
          id="hero-title"
          className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
        >
          Three introductions a week. Not three hundred.
        </h1>
        <p className="text-muted-foreground max-w-xl text-lg">
          Shortlist is dating that behaves like a good hiring process: verified
          people, a small shortlist, time-boxed conversations and an honest
          ending. Built for the ones who moved cities for a first job and are
          tired of swiping.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={buttonVariants({ size: "lg" })}>
            Create account
          </Link>
          <Link
            href="/demo"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Try the demo in 5 minutes
          </Link>
          <Link
            href="/login"
            className={buttonVariants({ variant: "ghost", size: "lg" })}
          >
            Log in
          </Link>
        </div>
        <p className="text-muted-foreground text-sm">
          This is a demonstration build. The members are invented, and nobody is
          charged anything.
        </p>
      </section>

      <Section id="problem" title="The problem with swipe apps">
        <p>
          If you are 22 to 29, you took a job in a new city, and you work long
          days, a swipe app asks for an hour a day and gives back a pile of
          profiles that never reply. Women get flooded with low-effort openers.
          Men get ignored. Everybody wonders which profiles are real. Most
          people who install these apps leave within a month, and they say why:
          too many shallow profiles, matches that go quiet, and nobody to trust.
        </p>
        <p>
          The pain is not too few people. It is too many people, no
          accountability and no ending. Shortlist takes volume away on purpose
          and adds the things that were missing.
        </p>
      </Section>

      <Section id="rules" title="The rules, in plain words">
        <ul className="grid gap-3 sm:grid-cols-2">
          {rules.map((r) => (
            <li key={r.head} className="rounded-lg border p-4">
              <h3 className="font-medium">{r.head}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{r.body}</p>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          These are not promises on a slide. They are enforced in the database,
          so the app cannot be talked out of them, and each one has automated
          tests.
        </p>
      </Section>

      <Section id="trust" title="Trust and safety">
        <ul className="grid gap-3 sm:grid-cols-2">
          {trust.map((t) => (
            <li key={t.head} className="rounded-lg border p-4">
              <h3 className="font-medium">{t.head}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{t.body}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Read the{" "}
          <Link href="/community-rules" className="underline">
            community rules
          </Link>
          , the{" "}
          <Link href="/safety" className="underline">
            safety tips
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="underline">
            privacy notice
          </Link>
          . They are drafts for this demonstration.
        </p>
      </Section>

      <Section id="plus" title="Plus is for convenience, never for safety">
        <p>
          The core is free: {FREE_LIMITS.introsPerDrop} intros a week,
          messaging, verification, reporting and blocking, and your data export
          and deletion. Plus ({formatRupees(PLANS.plus_1m.amountPaise)} for a
          month, {formatRupees(PLANS.plus_3m.amountPaise)} for three, one-time,
          no auto-renewal) adds {PLUS_PERKS.introsPerDrop} intros a week,{" "}
          {PLUS_PERKS.chatCap} chats at once, the full why-we-matched breakdown
          and one second look a month.
        </p>
        <Link href="/plus" className={buttonVariants({ variant: "outline" })}>
          See what Plus includes
        </Link>
      </Section>

      <Section
        id="roadmap"
        title="What is real, what is simulated, what is next"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <h3 className="font-medium">Real</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Sign-up, the 18+ check, matching and the weekly drop, the chat
              rules and the expiry job, block and report, the admin queue, data
              export and deletion.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="font-medium">Simulated</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              The pH ID check only looks at the format; I have no access to
              eLitmus data. Payments run in test mode or a fake checkout. Email
              may go to a test inbox.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="font-medium">Next</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Real eLitmus sign-in, selfie or document verification, push and
              WhatsApp nudges, Saturday plans at partner venues, Hindi and other
              languages, and a lawyer&apos;s review of every policy.
            </p>
          </div>
        </div>
        <p className="text-sm">
          The reasoning behind each choice is in the decision log in the
          repository (<code>docs/decisions.md</code>), written down as I made
          them.
        </p>
      </Section>

      <Section id="why-elitmus" title="Why this belongs at eLitmus">
        <p>
          Anyone can build a matching engine. What is hard to copy is a graph of
          people who each sat a proctored test, with a registered identity, a
          batch year and a city. That is the moat: a verified cohort of
          first-job graduates who already trust the name. It gives a new app a
          trusted identity on day one, an audience that can be reached without
          paid advertising, and shared context (&quot;which batch were
          you?&quot;) that makes the first message easy.
        </p>
        <p className="text-muted-foreground text-sm">
          It is also a risk to the brand, which is why the product never shows a
          score, keeps the eLitmus link opt-in and treats safety as a feature
          nobody pays for.
        </p>
      </Section>

      <section
        aria-labelledby="cta-title"
        className="bg-muted space-y-4 rounded-xl p-6"
      >
        <h2 id="cta-title" className="text-xl font-semibold tracking-tight">
          See it working in five minutes
        </h2>
        <p className="text-muted-foreground text-sm">
          The demo guide has ready-made logins and a step-by-step script. Or
          make your own account and go through onboarding.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/demo" className={buttonVariants()}>
            Open the demo guide
          </Link>
          <Link
            href="/signup"
            className={buttonVariants({ variant: "outline" })}
          >
            Create account
          </Link>
        </div>
      </section>
    </div>
  );
}
