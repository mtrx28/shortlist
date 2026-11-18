import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/admin/require-admin";
import { ageText } from "@/lib/safety/sla";
import { markContactHandledAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact messages | Admin | Shortlist" };

// Messages people sent from the grievance page. Read with the admin's own
// session (row level security: admins only).
export default async function ContactAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase
    .from("contact_messages")
    .select("id, name, email, message, status, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = data ?? [];
  const now = new Date();

  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Contact messages
      </h1>
      {result === "handled" && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          Marked as handled.
        </p>
      )}
      {result === "failed" && (
        <p role="alert" className="text-destructive text-sm">
          That did not work (it may already be handled).
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing waiting.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.map((m) => (
            <li key={m.id as string} className="space-y-2 px-3 py-3">
              <p>
                <span className="font-medium">{m.name as string}</span>{" "}
                <span className="text-muted-foreground">
                  ({m.email as string}), {ageText(m.created_at as string, now)}{" "}
                  ago
                </span>
              </p>
              <p className="whitespace-pre-wrap">{m.message as string}</p>
              <form action={markContactHandledAction}>
                <input type="hidden" name="id" value={m.id as string} />
                <Button type="submit" variant="outline" size="sm">
                  Mark handled
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
