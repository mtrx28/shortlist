import Link from "next/link";
import { LegalPage, Section } from "@/components/legal/legal-page";

export const metadata = { title: "Safety tips | Shortlist" };

export default function SafetyPage() {
  return (
    <LegalPage
      title="Safety tips"
      intro="Meeting someone new is exciting. These habits keep it that way."
    >
      <Section title="Before you meet">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Chat in the app for a while. Ask questions. Notice how they react to
            a no.
          </li>
          <li>Do a video call first if you can.</li>
          <li>
            Keep your phone number, address and workplace to yourself until you
            trust them.
          </li>
          <li>
            Search their name and photo online; a profile that does not add up
            is a warning.
          </li>
        </ul>
      </Section>
      <Section title="The first meeting">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Meet in a busy public place, in daylight, and arrange your own
            travel.
          </li>
          <li>
            Tell a friend who, where and when, and share your live location with
            them.
          </li>
          <li>
            Keep your drink and your phone with you. Leave if you feel uneasy,
            without explaining.
          </li>
        </ul>
      </Section>
      <Section title="Never">
        <ul className="list-disc space-y-1 pl-5">
          <li>Send money, gift cards or OTPs, whatever the reason or story.</li>
          <li>Click links or install apps a match sends you.</li>
          <li>Share intimate photos. They can be used against you later.</li>
        </ul>
      </Section>
      <Section title="If something goes wrong">
        <p>
          Block and report the person from their profile or the chat; we read
          every report. If you are in danger call 112, India&apos;s emergency
          number. For online fraud you can call 1930 or use cybercrime.gov.in.
          You can also write to us on the{" "}
          <Link href="/grievance" className="underline">
            grievance page
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
