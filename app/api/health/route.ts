import { NextResponse } from "next/server";
import { buildHealthReport } from "@/lib/health";

// Always compute on request, never cache: a cached "ok" would be useless.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildHealthReport());
}
