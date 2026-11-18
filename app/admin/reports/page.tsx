import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { reasonLabel } from "@/config/safety";
import { ageText, slaState, slaText, type SlaReport } from "@/lib/safety/sla";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports | Admin | Shortlist" };

type Row = SlaReport & {
  id: string;
  reporter_id: string | null;
  target_id: string | null;
  reason: string;
};

// The reports queue. It lists who and why, the age of each report and a flag
// when it is past our own DRAFT targets (see config/safety.ts). The reporter's
// attached messages are NOT here: they are opened one report at a time.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; result?: string }>;
}) {
  const { show, result } = await searchParams;
  const { supabase } = await requireAdmin();
  const showAll = show === "all";

  let query = supabase
    .from("reports")
    .select(
      "id, reporter_id, target_id, reason, status, created_at, ack_at, resolved_at",
    )
    .order("created_at", { ascending: true })
    .limit(200);
  if (!showAll) query = query.in("status", ["open", "ack"]);
  const { data } = await query;
  const rows = (data ?? []) as Row[];

  // Display names only (the admin may read profiles; nothing else is shown).
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.reporter_id, r.target_id]).filter(Boolean),
    ),
  ] as string[];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] };
  const name = new Map(
    (people ?? []).map((p) => [p.id as string, p.display_name as string]),
  );
  const label = (id: string | null) =>
    id ? (name.get(id) ?? "Unknown") : "Deleted account";

  const now = new Date();
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm">
          <Link
            href={showAll ? "/admin/reports" : "/admin/reports?show=all"}
            className="underline"
          >
            {showAll ? "Show only open" : "Show all"}
          </Link>
        </p>
      </div>
      {result === "invalid" && (
        <p role="alert" className="text-destructive text-sm">
          That request was not valid.
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Draft targets: acknowledge within 24 hours, resolve within 15 days.
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No reports here.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.map((r) => {
            const state = slaState(r, now);
            return (
              <li key={r.id} className="space-y-1 px-3 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/admin/reports/${r.id}`}
                    className="font-medium underline"
                  >
                    {reasonLabel(r.reason)}
                  </Link>
                  <span className="text-muted-foreground">
                    {r.status} · age {ageText(r.created_at, now)}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {label(r.reporter_id)} reported {label(r.target_id)}
                </p>
                {(state === "ack_overdue" || state === "resolve_overdue") && (
                  <p className="text-destructive font-medium">
                    Overdue: {slaText(state)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
