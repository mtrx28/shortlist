import { POLICY_VERSION } from "@/lib/consent";

export const metadata = { title: "Privacy | Shortlist" };

export default function PrivacyPage() {
  return (
    <article className="max-w-2xl space-y-4">
      <p className="rounded-md border border-dashed p-3 text-sm">
        Template only. This Privacy Notice is a placeholder and is not the final
        text. Version {POLICY_VERSION}.
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Privacy notice</h1>
      <p className="text-muted-foreground text-sm">
        The real notice will go here: what we collect (and what we deliberately
        do not), why, how long we keep it, how to export or delete your data,
        and who to contact with a complaint.
      </p>
    </article>
  );
}
