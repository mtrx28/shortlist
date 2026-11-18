import { describe, expect, it } from "vitest";
import {
  checkHealthBody,
  checkSecurityHeaders,
  normaliseBaseUrl,
} from "../../scripts/smoke/checks";
import { buildSecurityHeaders } from "@/lib/security-headers";

const asHeaders = (list: { key: string; value: string }[]) =>
  new Headers(list.map((h): [string, string] => [h.key, h.value]));

describe("checkSecurityHeaders", () => {
  const deployed = {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
  };

  it("accepts the headers the app really sends on https", () => {
    const headers = asHeaders(buildSecurityHeaders(deployed));
    expect(checkSecurityHeaders(headers, true)).toEqual([]);
  });

  it("asks for HSTS on https but not on plain http", () => {
    const local = asHeaders(
      buildSecurityHeaders({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    );
    expect(checkSecurityHeaders(local, false)).toEqual([]);
    expect(checkSecurityHeaders(local, true).join(" ")).toMatch(
      /strict-transport-security/,
    );
  });

  it("lists every missing header", () => {
    expect(checkSecurityHeaders(new Headers(), false)).toHaveLength(5);
  });

  it("flags a framing-friendly or wide-open policy and x-powered-by", () => {
    const headers = new Headers({
      "content-security-policy": "default-src *",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=()",
      "x-powered-by": "Next.js",
    });
    const text = checkSecurityHeaders(headers, false).join(" | ");
    expect(text).toMatch(/framing/);
    expect(text).toMatch(/allows everything/);
    expect(text).toMatch(/x-powered-by/);
  });
});

describe("checkHealthBody", () => {
  it("wants status ok", () => {
    expect(checkHealthBody({ status: "ok", app: "shortlist" })).toEqual([]);
    expect(checkHealthBody({ status: "down" })).toHaveLength(1);
    expect(checkHealthBody(null)).toHaveLength(1);
    expect(checkHealthBody("ok")).toHaveLength(1);
  });
});

describe("normaliseBaseUrl", () => {
  it("cleans addresses people paste", () => {
    expect(normaliseBaseUrl("https://x.vercel.app/")).toBe(
      "https://x.vercel.app",
    );
    expect(normaliseBaseUrl("x.vercel.app")).toBe("https://x.vercel.app");
    expect(normaliseBaseUrl(" http://localhost:3000/path ")).toBe(
      "http://localhost:3000",
    );
  });
  it("rejects empty and odd input", () => {
    expect(normaliseBaseUrl(undefined)).toBeNull();
    expect(normaliseBaseUrl("")).toBeNull();
    expect(normaliseBaseUrl("ftp://x.com")).toBeNull();
  });
});
