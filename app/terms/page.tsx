import { POLICY_VERSION } from "@/lib/consent";

export const metadata = { title: "Terms | Shortlist" };

export default function TermsPage() {
  return (
    <article className="max-w-2xl space-y-4">
      <p className="rounded-md border border-dashed p-3 text-sm">
        Template only. These Terms are a placeholder and are not the final text.
        Version {POLICY_VERSION}.
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Terms of use</h1>
      <p className="text-muted-foreground text-sm">
        The real terms will go here: who can use Shortlist (adults only, 18+),
        how accounts and conversations work, what behaviour is not allowed, and
        how reports are handled.
      </p>
    </article>
  );
}
