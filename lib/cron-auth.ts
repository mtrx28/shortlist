import { createHash, timingSafeEqual } from "node:crypto";

// Checks the "Authorization: Bearer <secret>" header that scheduled jobs send
// to /api/cron/* endpoints.
//   * If CRON_SECRET is not set (or empty) NOTHING is authorised, so a
//     forgotten setting can never leave the endpoint open.
//   * Both sides are hashed first, so the two buffers always have the same
//     length, and compared with timingSafeEqual, so the time taken does not
//     leak how many leading characters were right.
export function isCronAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret) return false;
  if (!authorizationHeader) return false;
  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  if (!match) return false;
  const given = createHash("sha256").update(match[1]).digest();
  const wanted = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, wanted);
}
