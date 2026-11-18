import Link from "next/link";
import { ContactForm } from "@/components/legal/contact-form";
import { LegalPage, Section } from "@/components/legal/legal-page";
import { LEGAL_CONFIG } from "@/config/legal";
import { SAFETY_CONFIG } from "@/config/safety";

export const metadata = { title: "Grievance and contact | Shortlist" };

export default function GrievancePage() {
  return (
    <LegalPage
      title="Grievance and contact"
      intro="If something is wrong, or you have a question about your data, tell us here."
    >
      <Section title="Grievance officer">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{LEGAL_CONFIG.grievanceOfficerName}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{LEGAL_CONFIG.grievanceEmail}</dd>
          <dt className="text-muted-foreground">Address</dt>
          <dd>{LEGAL_CONFIG.postalAddress}</dd>
        </dl>
      </Section>

      <Section title="What to expect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            We aim to acknowledge every complaint and every report within{" "}
            {SAFETY_CONFIG.ackWithinHours} hours.
          </li>
          <li>
            We aim to resolve it within {SAFETY_CONFIG.resolveWithinDays} days
            and to tell you what we did.
          </li>
          <li>
            These are my targets for this draft. They are not a legal promise.
          </li>
        </ul>
        <p>
          For a safety problem with another member, use Report on their profile
          or chat instead: it reaches the moderators directly and can include
          the messages.
        </p>
      </Section>

      <Section title="Write to us">
        <ContactForm />
      </Section>

      <p>
        See also the{" "}
        <Link href="/privacy" className="underline">
          privacy notice
        </Link>
        .
      </p>
    </LegalPage>
  );
}
