// The security headers for every page, built from the environment so they can
// be tested. next.config.ts calls buildSecurityHeaders().
//
// The Content Security Policy (CSP) tells the browser which places the page may
// load things from, so a bug that lets someone inject a script or an image tag
// cannot send data elsewhere.
//
// Where the app talks to:
//   * itself;
//   * Supabase: its API, realtime (a WebSocket) and signed photo links, all on
//     the host in NEXT_PUBLIC_SUPABASE_URL (a local host while testing);
//   * Razorpay Checkout (the payment window and its script). Razorpay does not
//     publish one official list, so these hosts come from how checkout.js
//     behaves (script from checkout.razorpay.com, the payment window in an
//     iframe from api.razorpay.com, telemetry to lumberjack.razorpay.com) and
//     from what other projects report. Re-check the browser console on the
//     deployed site with a test payment (see docs/deploy.md).
//
// Honest trade-off: script-src has 'unsafe-inline' because Next.js puts small
// inline scripts in every page and a per-request nonce would make every page
// dynamic. React escapes everything it renders and the code never uses
// dangerouslySetInnerHTML, but a nonce-based policy would be stronger.

type Env = Record<string, string | undefined>;

const RAZORPAY_SCRIPT = ["https://checkout.razorpay.com"];
const RAZORPAY_FRAME = [
  "https://api.razorpay.com",
  "https://checkout.razorpay.com",
];
const RAZORPAY_CONNECT = [
  "https://api.razorpay.com",
  "https://checkout.razorpay.com",
  "https://lumberjack.razorpay.com",
];
// Bank logos and the Razorpay mark.
const RAZORPAY_IMG = ["https://*.razorpay.com"];

function supabaseOrigins(env: Env): { http: string; ws: string } | null {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const ws = (url.protocol === "https:" ? "wss://" : "ws://") + url.host;
    return { http: url.origin, ws };
  } catch {
    return null;
  }
}

// "Upgrade every request to https" and HSTS only make sense on a real https
// site. When the production build is served over plain http on this machine
// (the local test setup), the upgrade would break every stylesheet and
// request, so it is switched off there.
export function shouldForceHttps(env: Env): boolean {
  const isProd = env.NODE_ENV === "production";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(
    env.NEXT_PUBLIC_APP_URL ?? "",
  );
  return isProd && !local;
}

export function contentSecurityPolicy(env: Env): string {
  const isProd = env.NODE_ENV === "production";
  const supabase = supabaseOrigins(env);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      // Only the dev server needs eval (hot reload).
      ...(isProd ? [] : ["'unsafe-eval'"]),
      ...RAZORPAY_SCRIPT,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...(supabase ? [supabase.http] : []),
      ...RAZORPAY_IMG,
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase.http, supabase.ws] : []),
      ...RAZORPAY_CONNECT,
      // Next.js hot reload socket while developing.
      ...(isProd ? [] : ["ws://localhost:*", "ws://127.0.0.1:*"]),
    ],
    "frame-src": RAZORPAY_FRAME,
    // Photo compression runs on the main thread (no worker), but a blob worker
    // is still allowed in case the library falls back to one.
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Nobody may put Shortlist inside a frame (clickjacking).
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  if (shouldForceHttps(env)) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

// Features Shortlist never uses are switched off. "payment" must name the
// Razorpay frames too, because the payment window is an iframe that asks for
// the Payment Request feature; "self" alone would refuse it.
export function permissionsPolicy(): string {
  const payment = ["self", ...RAZORPAY_FRAME.map((h) => `"${h}"`)].join(" ");
  return `camera=(), microphone=(), geolocation=(), payment=(${payment})`;
}

export function buildSecurityHeaders(
  env: Env,
): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    // Only ever use https for this site (ignored by browsers on plain http).
    ...(shouldForceHttps(env)
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ]
      : []),
    // Older browsers that do not know frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Do not leak chat or profile paths to other sites in the Referer header.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: permissionsPolicy() },
  ];
}
