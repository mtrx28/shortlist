import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reasonLabel } from "@/config/safety";
import { requireAdmin } from "@/lib/admin/require-admin";
import { ageText, slaState, slaText } from "@/lib/safety/sla";
import { getReportInDb } from "@/lib/safety/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveReportAction, unsuspendAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report | Admin | Shortlist" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESULT_TEXT: Record<string, string> = {
  ack: "Marked as acknowledged.",
  actioned: "Marked as actioned.",
  dismissed: "Dismissed.",
  suspended: "Actioned, and the person is suspended.",
  unsuspended: "The suspension was lifted.",
  already_resolved: "That report was already finished.",
  already_acknowledged: "That report was already acknowledged.",
  cannot_suspend: "Admin accounts cannot be suspended here.",
  target_gone: "That account no longer exists.",
  bad_note: "The note must be plain text, up to 1000 characters.",
  forbidden: "You are not allowed to do that.",
  failed: "That did not work. Nothing was changed.",
};

// One report. It shows what the report itself carries: the reason, the
// reporter's own words, the two display names. The messages the reporter
// attached are shown only after you ask for them, and asking is logged.
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ evidence?: string; result?: string }>;
}) {
  const { id } = await params;
  const { evidence, result } = await searchParams;
  if (!UUID.test(id)) notFound();
  const { adminId } = await requireAdmin();
  const service = createAdminClient();
  if (!service) notFound();

  const loaded = await getReportInDb(service, {
    adminId,
    reportId: id,
    withEvidence: evidence === "1",
  });
  if (!loaded.ok) notFound();
  const r = loaded.value;

  const now = new Date();
  const state = slaState(r, now);
  const finished = r.status === "actioned" || r.status === "dismissed";

  return (
    <section className="max-w-2xl space-y-6">
      <p className="text-sm">
        <Link href="/admin/reports" className="underline">
          All reports
        </Link>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {reasonLabel(r.reason)}
      </h1>
      {result && RESULT_TEXT[result] && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {RESULT_TEXT[result]}
        </p>
      )}

      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{r.status}</dd>
        <dt className="text-muted-foreground">Age</dt>
        <dd>
          {ageText(r.created_at, now)}{" "}
          <span
            className={
              state === "ack_overdue" || state === "resolve_overdue"
                ? "text-destructive font-medium"
                : "text-muted-foreground"
            }
          >
            ({slaText(state)})
          </span>
        </dd>
        <dt className="text-muted-foreground">Reporter</dt>
        <dd>{r.reporter_name ?? "Deleted account"}</dd>
        <dt className="text-muted-foreground">Reported</dt>
        <dd>
          {r.target_name ?? "Deleted account"}
          {r.target_suspended ? " (suspended)" : ""}
        </dd>
        <dt className="text-muted-foreground">Other reports</dt>
        <dd>{r.other_reports_about_target} more about this person</dd>
        <dt className="text-muted-foreground">Reporter&apos;s words</dt>
        <dd className="whitespace-pre-wrap">{r.details ?? "None"}</dd>
        {r.admin_note && (
          <>
            <dt className="text-muted-foreground">Admin note</dt>
            <dd className="whitespace-pre-wrap">{r.admin_note}</dd>
          </>
        )}
      </dl>

      <div className="space-y-2">
        <h2 className="text-base font-medium">Attached messages</h2>
        {!r.has_evidence ? (
          <p className="text-muted-foreground text-sm">
            The reporter did not attach any messages. You cannot read their
            chat.
          </p>
        ) : r.evidence ? (
          <ol className="space-y-2 rounded-lg border p-3 text-sm">
            {r.evidence.map((m, i) => (
              <li key={i}>
                <span className="text-muted-foreground">
                  {m.from === "reporter" ? "Reporter" : "Reported person"},{" "}
                  {new Date(m.at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                  :
                </span>{" "}
                <span className="whitespace-pre-wrap">{m.body}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              The reporter attached recent messages. Opening them is written to
              the audit log.
            </p>
            <Link
              href={`/admin/reports/${r.id}?evidence=1`}
              className="underline"
            >
              Show the attached messages
            </Link>
          </div>
        )}
      </div>

      {!finished && (
        <form
          action={resolveReportAction}
          className="space-y-3 rounded-lg border p-4"
        >
          <input type="hidden" name="reportId" value={r.id} />
          <h2 className="text-base font-medium">Decide</h2>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">
              Note (optional, kept with the report)
            </span>
            <textarea
              name="note"
              rows={3}
              maxLength={1000}
              className="bg-background w-full rounded-md border px-2 py-2"
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="suspend" className="mt-1" />
            <span>
              Also suspend the reported person (only with &quot;Action&quot;).
              Their profile is hidden, their chats end and they cannot use the
              app.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {r.status === "open" && (
              <Button type="submit" name="action" value="ack" variant="outline">
                Acknowledge
              </Button>
            )}
            <Button type="submit" name="action" value="action">
              Action
            </Button>
            <Button
              type="submit"
              name="action"
              value="dismiss"
              variant="outline"
            >
              Dismiss
            </Button>
          </div>
        </form>
      )}

      {r.target_suspended && r.target_id && (
        <form action={unsuspendAction} className="space-y-2">
          <input type="hidden" name="targetId" value={r.target_id} />
          <input type="hidden" name="reportId" value={r.id} />
          <Button type="submit" variant="outline">
            Lift the suspension
          </Button>
        </form>
      )}
    </section>
  );
}
