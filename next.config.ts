import type { NextConfig } from "next";

// Security headers for every page. The Content Security Policy (CSP) tells the
// browser which places the page may load things from, so a bug that lets
// someone inject a script or an image tag cannot send data elsewhere.
//
// Where the app talks to:
//   * itself;
//   * Supabase: its API, realtime (a WebSocket) and signed photo links, all on
//     the host in NEXT_PUBLIC_SUPABASE_URL (a local host while testing);
//   * Razorpay checkout (the payment window and its script), added for the
//     payments milestone.
//
// Honest trade-off: script-src has 'unsafe-inline' because Next.js puts small
// inline scripts in every page and a per-request nonce would make every page
// dynamic. React escapes everything it renders and the code never uses
// dangerouslySetInnerHTML, but a nonce-based policy would be stronger.
const isProd = process.env.NODE_ENV === "production";

// "Upgrade every request to https" and HSTS only make sense on a real https
// site. When the production build is served over plain http on this machine
// (the local test setup), the upgrade would break every stylesheet and
// request, so it is switched off there.
const servedOverLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)/.test(
  process.env.NEXT_PUBLIC_APP_URL ?? "",
);
const forceHttps = isProd && !servedOverLocalHttp;

function supabaseOrigins(): { http: string; ws: string } | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const ws = (url.protocol === "https:" ? "wss://" : "ws://") + url.host;
    return { http: url.origin, ws };
  } catch {
    return null;
  }
}

function contentSecurityPolicy(): string {
  const supabase = supabaseOrigins();
  const razorpayScripts = "https://checkout.razorpay.com";
  const razorpayFrames =
    "https://api.razorpay.com https://checkout.razorpay.com";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      // Only the dev server needs eval (hot reload).
      ...(isProd ? [] : ["'unsafe-eval'"]),
      razorpayScripts,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...(supabase ? [supabase.http] : []),
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase.http, supabase.ws] : []),
      "https://lumberjack.razorpay.com",
      // Next.js hot reload socket while developing.
      ...(isProd ? [] : ["ws://localhost:*", "ws://127.0.0.1:*"]),
    ],
    "frame-src": [razorpayFrames],
    // Photo compression runs in a worker made from a blob.
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
  if (forceHttps) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  // Only ever use https for this site (ignored by browsers on plain http).
  ...(forceHttps
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
  // Features Shortlist never uses are switched off.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
];

const nextConfig: NextConfig = {
  // The test setup builds into its own folder so it never disturbs a normal
  // dev server or build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
