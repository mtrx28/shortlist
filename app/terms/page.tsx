import Link from "next/link";
import { LegalPage, Section } from "@/components/legal/legal-page";

export const metadata = { title: "Terms of use | Shortlist" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro="These are the rules for using Shortlist. I wrote them in plain words on purpose."
    >
      <Section title="1. Who can use Shortlist">
        <p>
          You must be at least 18. You give your real date of birth when you
          sign up and we check it. You may have one account, and the details in
          it must be about you and true.
        </p>
      </Section>

      <Section title="2. What Shortlist does">
        <p>
          Once a week we show you a few people we think you might get along
          with. If you both say Interested, a chat opens for 72 hours. After two
          days, if you have both written, each of you chooses to keep talking or
          to close the chat kindly. You can have a limited number of chats open
          at once. Nothing here promises that you will meet anyone.
        </p>
      </Section>

      <Section title="3. How we expect you to behave">
        <p>
          Be honest and respectful. The{" "}
          <Link href="/community-rules" className="underline">
            community rules
          </Link>{" "}
          are part of these terms. In short: no harassment, no pressure, no fake
          profiles, no asking for money, no photos of other people, and no
          sharing anyone&apos;s private details.
        </p>
      </Section>

      <Section title="4. Reports, blocks and suspension">
        <p>
          You can report or block anyone you were introduced to. We read
          reports, and we may warn, suspend or remove accounts that break these
          terms. If we suspend you, you can still download your data, delete
          your account and write to us on the{" "}
          <Link href="/grievance" className="underline">
            grievance page
          </Link>
          .
        </p>
      </Section>

      <Section title="5. Your content">
        <p>
          You own what you write and upload. You allow us to show it to the
          people we introduce you to, and to keep it for as long as your account
          exists, so the service can work. Do not upload anything you do not
          have the right to share.
        </p>
      </Section>

      <Section title="6. Verification">
        <p>
          The eLitmus badge in this demonstration is simulated. A badge does not
          mean we vouch for a person. Meet people carefully; read the{" "}
          <Link href="/safety" className="underline">
            safety tips
          </Link>
          .
        </p>
      </Section>

      <Section title="7. Ending your account">
        <p>
          You can delete your account at any time from your account pages. We
          describe what is removed and what is kept in the{" "}
          <Link href="/privacy" className="underline">
            privacy notice
          </Link>
          .
        </p>
      </Section>

      <Section title="8. Limits of what we promise">
        <p>
          This is a demonstration product. It is provided as it is, without
          promises about availability. We are not responsible for what other
          members say or do, but we will act on reports. Nothing here limits
          rights you have under the law that cannot be limited.
        </p>
      </Section>

      <Section title="9. Changes">
        <p>
          If we change these terms in a way that matters we will change the
          version number and ask you to accept the new text again, on your
          privacy page.
        </p>
      </Section>

      <Section title="10. Plus and refunds (draft for demonstration)">
        <p>
          Shortlist Plus is a one-time purchase for a fixed period (30 or 90
          days). It does not renew by itself and we do not store your card.
          Safety tools, verification and the weekly introductions stay free
          whether or not you buy Plus. In this demonstration the payments are
          made in a test mode or a simulated checkout, so no real money moves.
        </p>
        <p>
          If a real service launched on these terms, my draft rule is: you can
          ask for a refund within 7 days of buying if you have not used the
          extra features, and at any time if a payment was taken but Plus was
          not switched on, or you were charged twice. Ask on the{" "}
          <Link href="/grievance" className="underline">
            grievance page
          </Link>{" "}
          and we will answer within the same targets as other complaints. A
          refund goes back to the payment method you used, through the payment
          company, and ends the Plus time that was refunded. This is a draft and
          must be checked against the law and the payment company&apos;s rules
          before a real launch.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          Questions or complaints: the{" "}
          <Link href="/grievance" className="underline">
            grievance page
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
