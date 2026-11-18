import Link from "next/link";
import { formatRupees } from "@/config/plans";
import { summarizeOrders, type OrderRow } from "@/lib/admin/orders-stats";
import { requireAdmin } from "@/lib/admin/require-admin";
import { countByName } from "@/lib/admin/stats";
import { slaState } from "@/lib/safety/sla";

export const dynamic = "force-dynamic";

// Dashboard stub. The counts are read with the admin's own session, so the
// database's row level security (admins only) applies on top of the role check.
export default async function AdminDashboardPage() {
  const { supabase } = await requireAdmin();

  const base = () =>
    supabase.from("profiles").select("id", { count: "exact", head: true });
  const count = async (
    filter: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
  ) => {
    const { count: n } = await filter(base());
    return n ?? null;
  };

  const [total, onboarded, none, pending, verified, paused, suspended] =
    await Promise.all([
      count((q) => q),
      count((q) => q.not("onboarding_completed_at", "is", null)),
      count((q) => q.eq("elitmus_status", "none")),
      count((q) => q.eq("elitmus_status", "pending")),
      count((q) => q.eq("elitmus_status", "verified")),
      count((q) => q.eq("paused", true)),
      count((q) => q.not("suspended_at", "is", null)),
    ]);

  // Safety queue: open and acknowledged reports, and how many are past our
  // own draft targets (see config/safety.ts).
  const { data: openReports } = await supabase
    .from("reports")
    .select("status, created_at, ack_at, resolved_at")
    .in("status", ["open", "ack"])
    .limit(1000);
  const now = new Date();
  const waiting = openReports ?? [];
  const overdue = waiting.filter((r) => {
    const s = slaState(r as Parameters<typeof slaState>[0], now);
    return s === "ack_overdue" || s === "resolve_overdue";
  }).length;
  const { count: contactOpen } = await supabase
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  // Plus and payments. Active members = finished onboarding, not paused, not
  // suspended. Conversion = members who paid at least once / active members.
  const { count: activeUsers } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .not("onboarding_completed_at", "is", null)
    .eq("paused", false)
    .is("suspended_at", null)
    .is("deleted_at", null);
  const { data: orderRows } = await supabase
    .from("orders")
    .select(
      "id, user_id, razorpay_order_id, razorpay_payment_id, plan, amount_paise, status, provider, created_at, paid_at, revoked_at",
    )
    .limit(5000);
  const orders = summarizeOrders(
    (orderRows ?? []) as OrderRow[],
    activeUsers ?? 0,
  );
  const { count: plusNow } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .gt("plus_until", new Date().toISOString());

  // The latest events, grouped by name. A stub: fine for a small database; a
  // real version would count in SQL.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: events } = await supabase
    .from("events")
    .select("name")
    .gte("at", since)
    .order("at", { ascending: false })
    .limit(5000);
  const byName = countByName(events ?? []);

  const cards: [string, number | null][] = [
    ["All profiles", total],
    ["Finished onboarding", onboarded],
    ["eLitmus: not requested", none],
    ["eLitmus: pending", pending],
    ["eLitmus: verified", verified],
    ["Paused", paused],
    ["Suspended", suspended],
  ];

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <div>
        <h2 className="mb-3 text-base font-medium">Users</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-2xl font-semibold">{value ?? "-"}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h2 className="mb-3 text-base font-medium">
          <Link
            href="/admin/orders"
            className="underline-offset-4 hover:underline"
          >
            Plus and orders
          </Link>
        </h2>
        <dl
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          data-testid="orders-stats"
        >
          {[
            ["Orders", String(orders.total)],
            ["Paid", String(orders.paid)],
            ["Not completed", String(orders.abandoned + orders.failed)],
            ["Paid total (test money)", formatRupees(orders.revenuePaise)],
            ["Plus members now", String(plusNow ?? "-")],
            [
              "Conversion (paid / active)",
              orders.conversionPercent === null
                ? "-"
                : `${orders.conversionPercent}%`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h2 className="mb-3 text-base font-medium">Safety</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">Open reports</dt>
            <dd className="text-2xl font-semibold">
              <Link
                href="/admin/reports"
                className="underline-offset-4 hover:underline"
              >
                {waiting.length}
              </Link>
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">
              Past draft targets
            </dt>
            <dd
              className={
                overdue > 0
                  ? "text-destructive text-2xl font-semibold"
                  : "text-2xl font-semibold"
              }
            >
              <Link
                href="/admin/reports"
                className="underline-offset-4 hover:underline"
              >
                {overdue}
              </Link>
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">Contact messages</dt>
            <dd className="text-2xl font-semibold">
              <Link
                href="/admin/contact"
                className="underline-offset-4 hover:underline"
              >
                {contactOpen ?? "-"}
              </Link>
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <h2 className="mb-3 text-base font-medium">Events, last 30 days</h2>
        {byName.length === 0 ? (
          <p className="text-muted-foreground text-sm">No events yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {byName.map((e) => (
              <li key={e.name} className="flex justify-between px-3 py-2">
                <span>{e.name}</span>
                <span className="font-medium">{e.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
