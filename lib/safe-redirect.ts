// Only allow redirects to a path on this site. Without this, a login link like
// /login?next=https://evil.example would send people away after signing in.
export function safeNextPath(value: unknown, fallback = "/home"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/")) return fallback;
  // "//host" and "/\host" are treated as other sites by browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
