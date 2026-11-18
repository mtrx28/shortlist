import { NextResponse } from "next/server";
import { runExpireJob } from "@/lib/conversation/expire-job";
import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Always run on request; never cache.
export const dynamic = "force-dynamic";

// Called every hour by a GitHub Actions schedule (.github/workflows/expire-chats.yml):
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/expire
// Ends chats whose reply window is over and updates reply rates. Running it
// twice is safe: the second call finds nothing left to end.
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
    const outcome = await runExpireJob(service);
    // Counts only: nothing about any one person.
    return NextResponse.json(outcome);
  } catch (error) {
    console.error(
      "expire job failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "expire_failed" }, { status: 500 });
  }
}
