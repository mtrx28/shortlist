import { NextResponse } from "next/server";
import { SAFETY_CONFIG } from "@/config/safety";
import { callDb } from "@/lib/safety/service";
import { isSameOrigin } from "@/lib/same-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /account/export/download: sends the signed-in person their own data as
// a JSON file. POST (not GET) so another website cannot trigger it with an
// image tag, and so it is covered by the SameSite cookie rule. The person
// comes from the session; the database function returns only that person's
// own data and counts exports (a few per day).
export async function POST(request: Request) {
  if (
    !isSameOrigin(request.headers.get("origin"), request.headers.get("host"))
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "signed_out" }, { status: 401 });
  }

  const result = await callDb<Record<string, unknown>>(
    service,
    "export_my_data",
    {
      p_user: data.user.id,
      p_now: new Date().toISOString(),
      p_max_per_day: SAFETY_CONFIG.exportsPerDay,
    },
  );
  if (!result.ok) {
    if (result.code === "rate_limited") {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: `You can download your data ${SAFETY_CONFIG.exportsPerDay} times a day. Please try again tomorrow.`,
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(result.value, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="shortlist-my-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
