import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runDropJob } from "@/lib/matching/drop-job";
import { createAdminClient } from "@/lib/supabase/admin";

// Always run on request; never cache.
export const dynamic = "force-dynamic";

// Called once a week by a GitHub Actions schedule (.github/workflows/weekly-drop.yml):
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/drop
// Running it twice in the same week is safe: the second call changes nothing.
export async function POST(request: Request) {
  if (
    !isCronAuthorized(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createAdminClient();
  if (!service) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    const outcome = await runDropJob(service, { source: "cron" });
    // Aggregate numbers only: nothing about any one person.
    return NextResponse.json({
      status: outcome.status,
      weekStart: outcome.weekStart,
      stats: outcome.stats ?? null,
    });
  } catch (error) {
    console.error(
      "weekly drop failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "drop_failed" }, { status: 500 });
  }
}
