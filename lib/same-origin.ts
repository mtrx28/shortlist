// A cheap guard for route handlers that change something (server actions get
// this check from Next.js itself). Browsers always send an Origin header on a
// POST; if it is there it must be this site. A missing Origin (curl, tests) is
// allowed because the request is still authenticated by the session cookie,
// which is SameSite=Lax and is not sent on cross-site POSTs anyway.
export function isSameOrigin(
  originHeader: string | null,
  hostHeader: string | null,
): boolean {
  if (!originHeader) return true;
  if (!hostHeader) return false;
  try {
    return new URL(originHeader).host === hostHeader;
  } catch {
    return false;
  }
}
