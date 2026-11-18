import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_LOGINS, demoEmail } from "@/config/demo";
import { readDemoGuideState } from "@/lib/demo-guide";

// Works for signed-out visitors (it is not behind login). It describes THIS
// deployment (demo controls on or off, payment mode, whether the password is
// shown) from the environment as it was when the site was built, so it is a
// static page: fast, and its title and description are in the first bytes of
// HTML for link previews. After changing one of those variables, redeploy.

export const metadata: Metadata = {
  title: "Evaluator guide: try Shortlist in five minutes",
  description:
    "Demo logins, a step-by-step script, and an honest list of what is simulated in this demonstration build of Shortlist.",
  alternates: { canonical: "/demo" },
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em] break-all">
      {children}
    </code>
  );
}

export default function DemoGuidePage() {
  const state = readDemoGuideState();

  const paymentsText = {
    simulated:
      "Payments are simulated here: a fake checkout page, nobody is charged and no card is asked for.",
    test: "Payments use Razorpay in test mode: use a published Razorpay test card, no real money moves.",
    live: "Live payments are switched on. This should never be the case for the demonstration.",
    not_configured:
      "Payments are not set up on this deployment, so the Plus checkout will show an error.",
  }[state.payments];

  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Evaluator guide
        </h1>
        <p className="text-muted-foreground max-w-xl">
          Shortlist gives each person three introductions a week and ends
          conversations kindly. This page gets you through the whole product in
          about five minutes, using invented members. It works without signing
          in.
        </p>
        <p role="note" className="bg-muted rounded-md p-3 text-sm">
          Demonstration environment. Everyone you will meet is fictional, and
          the data may be reset at any time. Please do not enter real personal
          details.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login" className={buttonVariants()}>
            Go to log in
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Back to the overview
          </Link>
        </div>
      </header>

      <section aria-labelledby="logins-title" className="space-y-3">
        <h2 id="logins-title" className="text-xl font-semibold tracking-tight">
          1. The demo logins
        </h2>
        <p className="text-sm">
          {state.publicPassword ? (
            <>
              Every demo login uses the same password:{" "}
              <Code>{state.publicPassword}</Code>
            </>
          ) : (
            <>
              The shared password is not printed on this page. It is on the
              submission form and in the README (<Code>DEMO_PASSWORD</Code>).
            </>
          )}
        </p>
        <div
          className="overflow-x-auto rounded-lg border"
          tabIndex={0}
          role="region"
          aria-label="Demo logins table, scrolls sideways on small screens"
        >
          <table className="w-full min-w-[34rem] table-fixed text-left text-sm">
            <caption className="sr-only">
              Demo logins and what each shows
            </caption>
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[20%]" />
              <col className="w-[36%]" />
            </colgroup>
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Email
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Who
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  What it shows
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {DEMO_LOGINS.map((l) => (
                <tr key={l.handle} className="align-top">
                  <td className="px-3 py-2">
                    <Code>{demoEmail(l.handle)}</Code>
                  </td>
                  <td className="px-3 py-2">{l.who}</td>
                  <td className="text-muted-foreground px-3 py-2">{l.shows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm">
          Other members (meera@, rohan@, lakshmi@ and so on, same domain and
          password) exist too, but the five above cover everything.
        </p>
      </section>

      <section aria-labelledby="script-title" className="space-y-4">
        <h2 id="script-title" className="text-xl font-semibold tracking-tight">
          2. A five-minute script
        </h2>
        <ol className="list-decimal space-y-5 pl-5">
          <li className="space-y-1">
            <h3 className="font-medium">
              Priya: see a shortlist and open a chat (2 min)
            </h3>
            <p className="text-sm">
              Log in as <Code>priya@</Code>. Open{" "}
              <strong>Your shortlist</strong>: three cards, each with the
              reasons we matched and a note box (140 characters, no links or
              phone numbers). Pick Pass or Interested; nothing tells the other
              person a pass happened. Then open <strong>Chats</strong> and the
              chat with Rohan: the 72 hour countdown is at the top, and the{" "}
              <strong>Safety</strong> button offers Report and Block.
            </p>
          </li>
          <li className="space-y-1">
            <h3 className="font-medium">
              Move the clock with the demo controls (1 min)
            </h3>
            <p className="text-sm">
              {state.controlsOn ? (
                <>
                  Demo controls are <strong>on</strong> here. At the bottom of
                  Priya&apos;s chat, press <strong>Jump to day 3</strong>: the
                  48 hour reminder appears, and because both have written you
                  get the <strong>Keep talking / Close kindly</strong> choice.
                  Closing sends the other person one of four blame-free notes.
                  &quot;Leave 4 hours&quot; and &quot;Make the time run
                  out&quot; show the countdown and expiry (the chat ends at the
                  next hourly run of the expiry job).
                </>
              ) : (
                <>
                  Demo controls are <strong>off</strong> on this deployment
                  (they need <Code>DEMO_CONTROLS=true</Code>), so the panel is
                  hidden. Without it, the clock moves in real time: the seeded
                  chat with Sneha is already close to its limit (see Arjun
                  below).
                </>
              )}
            </p>
          </li>
          <li className="space-y-1">
            <h3 className="font-medium">
              Arjun: the woman-first rule and the cap (1 min)
            </h3>
            <p className="text-sm">
              Log out, then log in as <Code>arjun@</Code>. His shortlist shows
              Meera, who already said Interested. The rule: if a man and a woman
              both say yes, <em>she</em> writes first, so the app never tells
              him whether she passed. His chat with Sneha has about 4 hours left
              because he has not replied; once he does, the day-3 choice opens.
              Free members can have 3 chats open at once.
            </p>
          </li>
          <li className="space-y-1">
            <h3 className="font-medium">
              Ananya: Plus and a second look (1 min)
            </h3>
            <p className="text-sm">
              Log in as <Code>ananya@</Code> and open <strong>Plus</strong>. She
              has 5 chats, 5 intros a week, the full why-we-matched breakdown on
              each card, and one <strong>second look</strong> a month to bring
              back an intro she passed on. Any other demo login can try Plus too
              {state.controlsOn ? (
                <>
                  : <strong>Grant me 30 days of Plus</strong> on the Plus page.
                </>
              ) : (
                <>
                  , through the checkout (see &quot;What is simulated&quot;
                  below).
                </>
              )}
            </p>
          </li>
          <li className="space-y-1">
            <h3 className="font-medium">
              Admin: verification, the weekly drop, reports and orders (2 min)
            </h3>
            <p className="text-sm">
              Log in as <Code>admin@</Code>. The dashboard opens with metrics
              cards: members, verified, active chats, intros delivered, reply
              rate within 72 hours, keep versus close decisions, Plus members
              and revenue (test mode). Then try <strong>Verifications</strong>{" "}
              (approve or reject a pending pH ID request),{" "}
              <strong>Reports</strong> (the queue, with how long each has
              waited), <strong>Orders</strong> and <strong>Drop</strong>.
              Running the drop replaces the scripted shortlists above, so do it
              last.
            </p>
          </li>
          <li className="space-y-1">
            <h3 className="font-medium">Safety, data export and deletion</h3>
            <p className="text-sm">
              Block and Report are on every card and chat; blocking hides you
              from each other and ends a live chat. Under{" "}
              <strong>Privacy and consents</strong> you can see what you agreed
              to and when, download your data as JSON, and delete your account.
              <strong> Do not delete a demo login</strong>: it would remove it
              for the next visitor. Create your own account to try deletion.
            </p>
          </li>
          <li className="space-y-1">
            <h3 className="font-medium">Sign up as a new member</h3>
            <p className="text-sm">
              <Link href="/signup" className="underline">
                Create an account
              </Link>{" "}
              to see the 18+ check, consent, and onboarding (basics, eight
              values questions, three prompts, interests, photos). A new member
              has no shortlist until the next weekly drop.
            </p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="sim-title" className="space-y-3">
        <h2 id="sim-title" className="text-xl font-semibold tracking-tight">
          3. What is simulated
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>eLitmus (pH) ID verification.</strong> I have no access to
            eLitmus data, so the form only checks that the ID looks right and
            keeps a keyed hash of it. An admin approves it by hand
            {state.autoVerify
              ? "; on this deployment requests are approved automatically."
              : "."}{" "}
            The pH score is never asked for or shown.
          </li>
          <li>
            <strong>Payments.</strong> {paymentsText}
          </li>
          <li>
            <strong>Email.</strong> Confirmation and reset emails depend on the
            mail service set up for this deployment, and the demo logins do not
            need them. Demo accounts exist only through the seed script.
          </li>
          <li>
            <strong>The members.</strong> Names, photos (generated pictures),
            prompts and chats are invented.
          </li>
          <li>
            <strong>Real:</strong> the matching and weekly drop, the chat rules
            and expiry, report and block, the admin queue, data export and
            deletion, and the database rules that enforce all of it.
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">
          The policy pages are drafts for this demonstration, not legal advice:{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>
          ,{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          ,{" "}
          <Link href="/community-rules" className="underline">
            Community rules
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
