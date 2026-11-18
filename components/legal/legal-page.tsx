import { LEGAL_CONFIG } from "@/config/legal";
import { POLICY_VERSION } from "@/lib/consent";

// Shared frame for the policy pages: a short banner saying this is a draft
// for the demonstration, then the text. Each page is plain headings and
// paragraphs so it is easy to read and easy to replace.
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="max-w-2xl space-y-5 text-sm leading-6">
      <p role="note" className="rounded-md border border-dashed p-3 text-xs">
        Draft for demonstration. Version {POLICY_VERSION}, last updated{" "}
        {LEGAL_CONFIG.lastUpdated}.
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {intro && <p className="text-muted-foreground">{intro}</p>}
      {children}
    </article>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
