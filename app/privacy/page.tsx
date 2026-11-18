import Link from "next/link";
import { LegalPage, Section } from "@/components/legal/legal-page";
import { LEGAL_CONFIG } from "@/config/legal";

export const metadata = { title: "Privacy notice | Shortlist" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy notice"
      intro="What Shortlist collects, why, how long it stays, and what you can do about it."
    >
      <Section title="1. Who is responsible">
        <p>
          Shortlist, as a demonstration project, decides why and how your data
          is used (in the language of India&apos;s data protection law, we are
          the data fiduciary). Contact:{" "}
          <Link href="/grievance" className="underline">
            grievance page
          </Link>
          .
        </p>
      </Section>

      <Section title="2. What we collect, and why">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Account:</strong> email and password (the password is kept
            by our sign-in provider, scrambled; we never see it), your name or
            nickname. Needed to give you an account.
          </li>
          <li>
            <strong>Date of birth:</strong> to check that you are 18 or older.
            Other members see your age, never your birth date.
          </li>
          <li>
            <strong>Profile:</strong> gender, who you are interested in, city
            (not your location), what you are looking for, batch year,
            occupation, optional college tier, your answers to the values
            questions, your three prompts, interests and photos. Needed to
            choose introductions and to show your profile to the few people we
            introduce you to.
          </li>
          <li>
            <strong>Chats:</strong> the messages you send. Needed to run the
            chat.
          </li>
          <li>
            <strong>eLitmus verification (optional):</strong> a scrambled
            fingerprint of the pH ID you enter, never the ID itself, kept only
            if you agree.
          </li>
          <li>
            <strong>Safety:</strong> reports, blocks and a log of what our
            moderators do.
          </li>
          <li>
            <strong>Activity records:</strong> simple counts such as &quot;an
            introduction was viewed&quot;. No message text, no names.
          </li>
          <li>
            <strong>Payments (later):</strong> order records. We do not store
            card details.
          </li>
        </ul>
        <p>
          We do not collect your phone number, your precise location, your
          contacts, or your pH score.
        </p>
      </Section>

      <Section title="3. Who sees what">
        <p>
          Other members see only the profile fields above, and only if we
          introduced you or you are chatting. Nobody can browse profiles. Our
          moderators see a report and the messages the reporter chose to attach
          to it, and nothing else of your chats. Our service providers (the
          database and hosting companies) process data for us; some of their
          servers are outside India.
        </p>
      </Section>

      <Section title="4. How long we keep it">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Your account data: until you delete your account. I plan to delete
            accounts that have been inactive for 12 months, after a notice; that
            automatic job is not built yet.
          </li>
          <li>
            Messages of a chat that has ended are no longer shown to you or the
            other person. I plan to remove them 90 days after the chat ends;
            that automatic clean-up is not built yet. They are removed at once
            if either of you deletes an account.
          </li>
          <li>
            Reports: the reporter&apos;s words and attached messages are kept
            while the report is open or was acted on, and removed when the
            report is dismissed or the reported person deletes their account.
          </li>
          <li>
            Safety record: if you delete your account while a report against you
            was open or acted on, we keep a scrambled code (not your id), the
            reason and the date. Nothing else.
          </li>
          <li>
            Payment records: without your name, as accounting rules require.
          </li>
        </ul>
      </Section>

      <Section title="5. Your rights">
        <p>You can, from your account pages:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            see and change your profile, and pause it (
            <Link href="/account/profile" className="underline">
              profile
            </Link>
            );
          </li>
          <li>
            see what you agreed to and withdraw optional consents (
            <Link href="/account/privacy" className="underline">
              privacy and consents
            </Link>
            );
          </li>
          <li>
            download your data (
            <Link href="/account/export" className="underline">
              download
            </Link>
            );
          </li>
          <li>
            delete your account (
            <Link href="/account/delete" className="underline">
              delete
            </Link>
            ).
          </li>
        </ul>
        <p>
          You can also complain to us, and, if you are not satisfied, to the
          Data Protection Board of India once it accepts complaints.
        </p>
      </Section>

      <Section title="6. Children">
        <p>
          Shortlist is for people who are 18 or older. If we learn that someone
          is under 18 we remove the account. You can report a profile that seems
          to belong to a minor.
        </p>
      </Section>

      <Section title="7. Security">
        <p>
          Data is stored with a hosted database that enforces who can read each
          row. Photos are private and shown only through short-lived links.
          Passwords are never stored by us. No system is perfectly safe; if
          something goes wrong with your data we will tell you and the
          authorities as the law requires.
        </p>
      </Section>

      <Section title="8. Complaints">
        <p>
          {LEGAL_CONFIG.grievanceOfficerName},{" "}
          <span>{LEGAL_CONFIG.grievanceEmail}</span>. Or use the{" "}
          <Link href="/grievance" className="underline">
            grievance page
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
