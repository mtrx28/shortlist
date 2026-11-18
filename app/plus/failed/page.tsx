import Link from "next/link";
import { requireUserProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payment not completed | Shortlist" };

// What each reason code (from our own server actions) says in plain words.
const WHY: Record<string, string> = {
  signature:
    "We could not verify that payment, so Plus was not turned on. If your bank shows a charge, contact us and quote the time of the payment.",
  rejected:
    "That payment did not match the order, so Plus was not turned on. If your bank shows a charge, contact us.",
  failed:
    "The payment did not go through. Nothing was charged, or the payment company will return the money to you.",
  invalid: "That payment confirmation was not valid, so nothing changed.",
  unavailable:
    "Payments are not available right now. Nothing was charged. Please try again later.",
};

export default async function PlusFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ why?: string }>;
}) {
  const { why } = await searchParams;
  await requireUserProfile();
  const text = (why && Object.hasOwn(WHY, why) && WHY[why]) || WHY.failed;

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Plus was not turned on
      </h1>
      <p role="status" className="text-sm">
        {text}
      </p>
      <p className="text-muted-foreground text-xs">
        Your free plan is unchanged and everything that keeps you safe still
        works.
      </p>
      <p className="flex gap-4 text-sm">
        <Link href="/plus" className="underline">
          Try again
        </Link>
        <Link href="/grievance" className="underline">
          Contact us
        </Link>
      </p>
    </section>
  );
}
