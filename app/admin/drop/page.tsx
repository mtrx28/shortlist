import { runDropAction } from "@/app/admin/drop/actions";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  percent,
  readDropStats,
  ZERO_REASON_LABELS,
} from "@/lib/matching/stats-view";
import type { ZeroIntroReason } from "@/lib/matching/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Weekly drop | Shortlist admin" };

const MESSAGES: Record<string, string> = {
  created: "Done. This week's drop was created.",
  exists:
    "This week's drop already exists, so nothing was changed. Tick the box to rebuild it (only possible while nobody has answered an intro).",
  blocked:
    "Not rebuilt: someone has already answered an intro in this week's drop.",
  not_configured: "The server is missing its Supabase service key.",
  failed: "Something went wrong. Nothing was changed.",
};

type DropRow = {
  id: string;
  week_start: string;
  run_at: string;
  stats: unknown;
};

export default async function DropPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { result } = await searchParams;

  // Admins may read drops through row level security.
  const { data } = await supabase
    .from("drops")
    .select("id, week_start, run_at, stats")
    .order("week_start", { ascending: false })
    .limit(4);
  const drops = (data ?? []) as DropRow[];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Weekly drop</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The drop normally runs by itself every Sunday evening. This button
          runs it now for the current week. Running it twice does not create
          duplicates. A demo drop from the seed script is replaced; a real one
          is left alone unless you tick the box and nobody has answered yet.
        </p>
      </div>

      {result && MESSAGES[result] && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {MESSAGES[result]}
        </p>
      )}

      <form action={runDropAction} className="space-y-3 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="rebuild" />
          Rebuild this week&apos;s drop if nobody has answered yet
        </label>
        <Button type="submit">Run drop now</Button>
      </form>

      {drops.length === 0 && (
        <p className="text-muted-foreground text-sm">No drops yet.</p>
      )}

      {drops.map((drop) => {
        const stats = readDropStats(drop.stats);
        return (
          <div key={drop.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">Week of {drop.week_start}</h2>
              <p className="text-muted-foreground text-xs">
                Run {new Date(drop.run_at).toLocaleString("en-IN")}
              </p>
            </div>
            {!stats ? (
              <p className="text-muted-foreground text-sm">
                Demo data from the seed script, no stats.
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["People considered", stats.usersConsidered],
                      ["Eligible", stats.usersEligible],
                      ["Intros created", stats.introsCreated],
                      [
                        "With at least one intro",
                        `${stats.usersWithIntros} (${percent(stats.shareWithAtLeastOneIntro)})`,
                      ],
                      ["With none", stats.usersWithZeroIntros],
                      [
                        "Shortlists per person (min / mean / max)",
                        `${stats.shortlistAppearances.min} / ${stats.shortlistAppearances.mean} / ${stats.shortlistAppearances.max}`,
                      ],
                    ] as [string, string | number][]
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-md border p-3">
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="text-xl font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="text-sm">
                  <p className="font-medium">Left out of the drop</p>
                  <p className="text-muted-foreground">
                    Paused {stats.skipped.paused}, suspended{" "}
                    {stats.skipped.suspended}, deleted {stats.skipped.deleted},
                    profile not finished {stats.skipped.onboarding_incomplete}.
                  </p>
                </div>
                <div className="text-sm">
                  <p className="font-medium">Why some people got no intro</p>
                  <ul className="text-muted-foreground list-disc pl-5">
                    {(Object.keys(ZERO_REASON_LABELS) as ZeroIntroReason[]).map(
                      (key) => (
                        <li key={key}>
                          {ZERO_REASON_LABELS[key]}:{" "}
                          {stats.zeroIntroReasons[key]}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
