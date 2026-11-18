// The pure parts of the smoke test, so they can be unit tested without a
// network. scripts/smoke.ts does the requests and calls these.

export type Problem = string;

const REQUIRED_HEADERS = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

// Looks at the response headers of a page and lists what is wrong.
export function checkSecurityHeaders(
  headers: Pick<Headers, "get">,
  isHttps: boolean,
): Problem[] {
  const problems: Problem[] = [];
  for (const name of REQUIRED_HEADERS) {
    if (!headers.get(name)) problems.push(`missing header ${name}`);
  }
  const csp = headers.get("content-security-policy") ?? "";
  if (csp && !/frame-ancestors 'none'/.test(csp)) {
    problems.push("CSP does not forbid framing (frame-ancestors 'none')");
  }
  if (csp && /default-src[^;]*\*/.test(csp)) {
    problems.push("CSP default-src allows everything");
  }
  if (isHttps) {
    if (!headers.get("strict-transport-security")) {
      problems.push("missing header strict-transport-security on https");
    }
    if (csp && !csp.includes("upgrade-insecure-requests")) {
      problems.push("CSP lacks upgrade-insecure-requests on https");
    }
  }
  if (headers.get("x-powered-by")) {
    problems.push("x-powered-by is exposed");
  }
  return problems;
}

// The health endpoint must answer {"status":"ok"}.
export function checkHealthBody(body: unknown): Problem[] {
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { status?: unknown }).status === "ok"
  ) {
    return [];
  }
  return ['health body is not {"status":"ok"}'];
}

// "https://x.vercel.app/" or "x.vercel.app" -> "https://x.vercel.app".
// Returns null if it is not a usable http(s) address.
export function normaliseBaseUrl(input: string | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  // Some other scheme (ftp://, file://): not something we can check.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return null;
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
