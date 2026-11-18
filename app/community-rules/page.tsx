import Link from "next/link";
import { LegalPage, Section } from "@/components/legal/legal-page";

export const metadata = { title: "Community rules | Shortlist" };

export default function CommunityRulesPage() {
  return (
    <LegalPage
      title="Community rules"
      intro="Shortlist only works if people feel safe. These are the rules every member agrees to."
    >
      <Section title="Do">
        <ul className="list-disc space-y-1 pl-5">
          <li>Be who you say you are. Use your own photos and facts.</li>
          <li>
            Answer kindly, or close a chat kindly. Silence is the worst answer.
          </li>
          <li>Take no for an answer, the first time.</li>
          <li>Keep early conversations inside the app.</li>
        </ul>
      </Section>
      <Section title="Do not">
        <ul className="list-disc space-y-1 pl-5">
          <li>Harass, insult, threaten or pressure anyone.</li>
          <li>Send sexual or violent content nobody asked for.</li>
          <li>Create fake profiles or pretend to be someone else.</li>
          <li>Ask for money, gifts, investments or financial help. Ever.</li>
          <li>Share someone else&apos;s photos, messages or details.</li>
          <li>Use Shortlist to sell, recruit or advertise.</li>
          <li>Join if you are under 18.</li>
        </ul>
      </Section>
      <Section title="What happens if the rules are broken">
        <p>
          Anyone can report or block from a profile or a chat. A person on our
          team reads each report. Depending on what happened we may warn,
          suspend or remove the account. The person who reported is not named to
          the person reported. For serious things we may need to involve the
          police.
        </p>
      </Section>
      <p>
        See also the{" "}
        <Link href="/safety" className="underline">
          safety tips
        </Link>{" "}
        and the{" "}
        <Link href="/terms" className="underline">
          terms
        </Link>
        .
      </p>
    </LegalPage>
  );
}
