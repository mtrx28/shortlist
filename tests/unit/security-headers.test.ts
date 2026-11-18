import { describe, expect, it } from "vitest";
import {
  buildSecurityHeaders,
  contentSecurityPolicy,
  permissionsPolicy,
  shouldForceHttps,
} from "@/lib/security-headers";

const prod = {
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://shortlist.example.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd1234.supabase.co",
};

function directive(csp: string, name: string): string[] {
  const part = csp.split("; ").find((p) => p.startsWith(name + " "));
  return part ? part.split(" ").slice(1) : [];
}

describe("content security policy", () => {
  const csp = contentSecurityPolicy(prod);

  it("allows Razorpay checkout to load, open its frame and call home", () => {
    expect(directive(csp, "script-src")).toContain(
      "https://checkout.razorpay.com",
    );
    expect(directive(csp, "frame-src")).toEqual(
      expect.arrayContaining([
        "https://api.razorpay.com",
        "https://checkout.razorpay.com",
      ]),
    );
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://api.razorpay.com",
        "https://lumberjack.razorpay.com",
      ]),
    );
    expect(directive(csp, "img-src")).toContain("https://*.razorpay.com");
  });

  it("allows the Supabase API and its realtime socket, and nothing else remote", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("https://abcd1234.supabase.co");
    expect(connect).toContain("wss://abcd1234.supabase.co");
    expect(directive(csp, "img-src")).toContain("https://abcd1234.supabase.co");
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
  });

  it("forbids framing, plugins and foreign form posts", () => {
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
  });

  it("allows eval only outside production", () => {
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(
      directive(
        contentSecurityPolicy({ ...prod, NODE_ENV: "development" }),
        "script-src",
      ),
    ).toContain("'unsafe-eval'");
  });

  it("copes with a missing or broken Supabase address", () => {
    expect(() =>
      contentSecurityPolicy({ NODE_ENV: "production" }),
    ).not.toThrow();
    expect(
      contentSecurityPolicy({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "not a url",
      }),
    ).not.toContain("not a url");
  });
});

describe("https upgrade", () => {
  it("is on for a deployed production build", () => {
    expect(shouldForceHttps(prod)).toBe(true);
    expect(contentSecurityPolicy(prod)).toContain("upgrade-insecure-requests");
  });
  it("is off for a production build served on this machine", () => {
    const local = { ...prod, NEXT_PUBLIC_APP_URL: "http://localhost:3100" };
    expect(shouldForceHttps(local)).toBe(false);
    expect(contentSecurityPolicy(local)).not.toContain(
      "upgrade-insecure-requests",
    );
  });
  it("is off in development", () => {
    expect(shouldForceHttps({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("permissions policy", () => {
  it("lets the payment window ask for payment, and switches the rest off", () => {
    const policy = permissionsPolicy();
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain(
      'payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")',
    );
  });
});

describe("buildSecurityHeaders", () => {
  it("sends HSTS only when forcing https", () => {
    const names = (env: Record<string, string>) =>
      buildSecurityHeaders(env).map((h) => h.key);
    expect(names(prod)).toContain("Strict-Transport-Security");
    expect(names({ NODE_ENV: "development" })).not.toContain(
      "Strict-Transport-Security",
    );
  });
  it("always sends the basics", () => {
    const names = buildSecurityHeaders(prod).map((h) => h.key);
    expect(names).toEqual(
      expect.arrayContaining([
        "Content-Security-Policy",
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
  });
});
