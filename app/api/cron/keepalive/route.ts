import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// A free Supabase project pauses after a week without activity. /api/health
// does not touch the database, so this endpoint runs one tiny query to count
// as activity. Called every few days by .github/workflows/keep-alive.yml.
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

  const { error } = await service.from("drops").select("id").limit(1);
  if (error) {
    return NextResponse.json(
      { error: "database_unreachable" },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}
