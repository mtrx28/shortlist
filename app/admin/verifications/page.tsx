import {
  approveVerificationAction,
  rejectVerificationAction,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Verifications | Shortlist admin" };

const MESSAGES: Record<string, string> = {
  approved: "Approved. The person now has the verified badge.",
  rejected: "Rejected. Their status is back to not requested.",
  already_handled: "That request was already handled.",
  invalid: "That request was not valid.",
  forbidden: "You are not allowed to do that.",
  failed: "Something went wrong. Nothing was changed.",
};

type Pending = {
  id: string;
  display_name: string;
  city: string | null;
  batch_year: number | null;
  verified_email: boolean;
  created_at: string;
};

export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { result } = await searchParams;

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, city, batch_year, verified_email, created_at")
    .eq("elitmus_status", "pending")
    .order("created_at", { ascending: true });
  const pending = (data ?? []) as Pending[];

  // Admins never see the date of birth, only an age worked out by the
  // database for people they may see.
  const ages = await Promise.all(
    pending.map(async (p) => {
      const { data: age } = await supabase.rpc("profile_age", { target: p.id });
      return typeof age === "number" ? age : null;
    }),
  );

  // Whether a pH ID hash is on file. Only the ids come back, never the hash.
  const service = createAdminClient();
  const withHash = new Set<string>();
  if (service && pending.length > 0) {
    const { data: rows } = await service
      .from("profiles")
      .select("id")
      .in(
        "id",
        pending.map((p) => p.id),
      )
      .not("elitmus_ref_hash", "is", null);
    for (const row of rows ?? []) withHash.add(row.id as string);
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Verification requests
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Demo only: nothing is checked against eLitmus records. Approve to show
          the verified badge; reject to send the person back to not requested.
        </p>
      </div>

      {result && MESSAGES[result] && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {MESSAGES[result]}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No pending requests right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map((p, i) => (
            <li key={p.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {p.display_name}
                  {ages[i] !== null && (
                    <span className="text-muted-foreground font-normal">
                      , {ages[i]}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground text-xs">
                  Joined {new Date(p.created_at).toLocaleDateString("en-IN")}
                </p>
              </div>
              <dl className="text-muted-foreground grid grid-cols-2 gap-1 text-sm">
                <dt>City</dt>
                <dd>{p.city ?? "Not set"}</dd>
                <dt>pH batch</dt>
                <dd>{p.batch_year ?? "Not set"}</dd>
                <dt>Email confirmed</dt>
                <dd>{p.verified_email ? "Yes" : "No"}</dd>
                <dt>pH ID hash on file</dt>
                <dd>{service ? (withHash.has(p.id) ? "Yes" : "No") : "?"}</dd>
              </dl>
              <div className="flex gap-2">
                <form action={approveVerificationAction}>
                  <input type="hidden" name="userId" value={p.id} />
                  <Button type="submit" size="sm">
                    Approve
                  </Button>
                </form>
                <form action={rejectVerificationAction}>
                  <input type="hidden" name="userId" value={p.id} />
                  <Button type="submit" size="sm" variant="destructive">
                    Reject
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
