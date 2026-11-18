import { revokePlusAction } from "@/app/admin/orders/actions";
import { Button } from "@/components/ui/button";
import { PLANS, formatRupees, isPlanId } from "@/config/plans";
import { maskId, type OrderRow } from "@/lib/admin/orders-stats";
import { requireAdmin } from "@/lib/admin/require-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders | Admin | Shortlist" };

const RESULT_TEXT: Record<string, string> = {
  revoked: "Plus was taken away and the action was logged.",
  not_plus: "That member does not have active Plus.",
  invalid: "That order was not found.",
  forbidden: "You are not allowed to do that.",
  failed: "That did not work. Try again.",
};

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

// The latest orders. It shows masked ids, the plan, the amount and the status;
// there are no card details anywhere in this app to show. Taking Plus away is
// an admin action that is written to the audit log.
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  const { supabase } = await requireAdmin();

  const { data } = await supabase
    .from("orders")
    .select(
      "id, user_id, razorpay_order_id, razorpay_payment_id, plan, amount_paise, status, provider, created_at, paid_at, revoked_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as OrderRow[];

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
      <p className="text-muted-foreground text-sm">
        The latest 100 orders. Amounts are test money. Ids are shortened. To
        refund a payment, do it in the payment provider&apos;s dashboard, then
        take Plus away here.
      </p>
      {result && RESULT_TEXT[result] && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {RESULT_TEXT[result]}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No orders yet.</p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border"
          tabIndex={0}
          role="region"
          aria-label="Orders table, scrolls sideways on small screens"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Orders, newest first</caption>
            <thead className="bg-muted/60">
              <tr>
                {[
                  "Created",
                  "Order",
                  "Payment",
                  "Member",
                  "Plan",
                  "Amount",
                  "Provider",
                  "Status",
                  "Action",
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2">
                    {dateFormat.format(new Date(o.created_at))}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {maskId(o.razorpay_order_id)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {maskId(o.razorpay_payment_id)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {o.user_id ? maskId(o.user_id) : "deleted"}
                  </td>
                  <td className="px-3 py-2">
                    {isPlanId(o.plan) ? PLANS[o.plan].label : o.plan}
                  </td>
                  <td className="px-3 py-2">{formatRupees(o.amount_paise)}</td>
                  <td className="px-3 py-2">{o.provider}</td>
                  <td className="px-3 py-2">
                    {o.status}
                    {o.revoked_at ? " (revoked)" : ""}
                  </td>
                  <td className="px-3 py-2">
                    {o.status === "paid" && !o.revoked_at && o.user_id && (
                      <form action={revokePlusAction}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <Button type="submit" size="sm" variant="outline">
                          Revoke Plus
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
