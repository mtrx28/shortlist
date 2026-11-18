import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static files, images, the health check and cron endpoints (they use a bearer secret, not a login); run on everything else.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/cron|api/webhooks|manifest.webmanifest|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
