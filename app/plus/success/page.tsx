import Link from "next/link";
import { z } from "zod";
import { PLUS_PERKS } from "@/config/plans";
import { isPlus } from "@/lib/plus";
import { requireUserProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export const metadata = { title: "Plus is on | Shortlist" };

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "long",
  timeZone: "Asia/Kolkata",
});

// Shown after a payment. It does not trust the address: what it says comes from
// the member's own profile and order, read through row level security.
export default async function PlusSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  const { supabase, userId } = await requireUserProfile();

  const { data: me } = await supabase
    .from("profiles")
    .select("plus_until")
    .eq("id", userId)
    .maybeSingle();
  const plusUntil = (me?.plus_until as string | null) ?? null;
  const active = isPlus(plusUntil, new Date());

  let paid = false;
  if (order && z.uuid().safeParse(order).success) {
    const { data } = await supabase
      .from("orders")
      .select("status")
      .eq("id", order)
      .eq("user_id", userId)
      .maybeSingle();
    paid = data?.status === "paid";
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      {paid && active ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Plus is on</h1>
          <p role="status" className="text-sm">
            Thank you. You have Plus until{" "}
            <strong>{dateFormat.format(new Date(plusUntil!))}</strong>.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Up to {PLUS_PERKS.chatCap} chats open at once.</li>
            <li>{PLUS_PERKS.introsPerDrop} intros in the next Sunday drop.</li>
            <li>
              The full &quot;why we matched&quot; breakdown on every intro.
            </li>
            <li>One second look every 30 days, on your shortlist page.</li>
          </ul>
          <p className="text-muted-foreground text-xs">
            This was a one-time purchase. It will not renew by itself.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            We are confirming your payment
          </h1>
          <p role="status" className="text-sm">
            We have not seen this payment confirmed yet. If you completed it,
            Plus turns on as soon as the payment company tells us, usually
            within a minute. Refresh this page in a moment. If nothing changes,
            contact us on the grievance page and quote this order.
          </p>
        </>
      )}
      <p className="flex gap-4 text-sm">
        <Link href="/shortlist" className="underline">
          Your shortlist
        </Link>
        <Link href="/plus" className="underline">
          Plus
        </Link>
      </p>
    </section>
  );
}
