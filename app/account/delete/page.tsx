import Link from "next/link";
import { DeleteForm } from "@/components/account/delete-form";
import { SAFETY_CONFIG } from "@/config/safety";
import { requireSession } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delete my account | Shortlist" };

// Reachable for every signed-in person, including a suspended one: the right
// to leave does not depend on standing.
export default async function DeleteAccountPage() {
  await requireSession();
  return (
    <section className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Delete my account
      </h1>
      <div className="space-y-2 text-sm">
        <p>This removes you from Shortlist for good. It cannot be undone.</p>
        <p className="font-medium">What is deleted</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your login, profile, answers and photos.</li>
          <li>
            Your introductions, your chats and every message in them. This
            includes the other person&apos;s copy of those chats, because a chat
            cannot exist with only one half.
          </li>
          <li>Your consent history, blocks and activity records.</li>
        </ul>
        <p className="font-medium">What is kept, and why</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Payment records without your name, because accounting rules require
            them.
          </li>
          <li>
            If someone reported you and the report was still being looked at or
            was acted on, a tiny safety record: a scrambled code that is not
            your id, the reason and the date. No name, no messages.
          </li>
          <li>
            A report you filed that is still open or was acted on stays, without
            your name, so the other case can be finished.
          </li>
        </ul>
        <p>
          Prefer a break?{" "}
          <Link href="/account/profile" className="underline">
            Pause your profile
          </Link>{" "}
          instead. Want a copy of your data first?{" "}
          <Link href="/account/export" className="underline">
            Download it
          </Link>
          .
        </p>
      </div>
      <DeleteForm phrase={SAFETY_CONFIG.deleteConfirmPhrase} />
    </section>
  );
}
