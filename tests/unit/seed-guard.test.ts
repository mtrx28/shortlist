import { describe, expect, it } from "vitest";
import {
  DEMO_EMAIL_DOMAIN,
  assertSeedAllowed,
  assertSeedTarget,
  demoEmail,
  isDemoEmail,
  isDemoUser,
  readDemoPassword,
} from "@/scripts/seed/guard";

describe("production guard", () => {
  it("refuses to run in production without --force-demo", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" }, [])).toThrow(
      /Refusing/,
    );
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production" }, ["--reset"]),
    ).toThrow(/Refusing/);
  });

  it("runs in production only when --force-demo is passed", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production" }, ["--force-demo"]),
    ).not.toThrow();
  });

  it("runs normally in development and when NODE_ENV is unset", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "development" }, []),
    ).not.toThrow();
    expect(() => assertSeedAllowed({}, [])).not.toThrow();
  });
});

describe("demo account detection", () => {
  it("builds emails on the demo domain", () => {
    expect(demoEmail("priya")).toBe(`priya@${DEMO_EMAIL_DOMAIN}`);
  });

  it("recognises demo emails only", () => {
    expect(isDemoEmail("priya@demo.shortlist.test")).toBe(true);
    expect(isDemoEmail("PRIYA@DEMO.SHORTLIST.TEST")).toBe(true);
    expect(isDemoEmail("priya@example.com")).toBe(false);
    expect(isDemoEmail("priya@demo.shortlist.test.evil.com")).toBe(false);
    expect(isDemoEmail("demo.shortlist.test@gmail.com")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
    expect(isDemoEmail(undefined)).toBe(false);
  });

  it("needs both the email domain and the demo flag before reset may delete", () => {
    const flag = { demo: true };
    const email = "a@demo.shortlist.test";
    expect(isDemoUser({ email, app_metadata: flag })).toBe(true);
    // Right email, no flag.
    expect(isDemoUser({ email, app_metadata: {} })).toBe(false);
    expect(isDemoUser({ email })).toBe(false);
    // Flag, but a real address.
    expect(isDemoUser({ email: "a@example.com", app_metadata: flag })).toBe(
      false,
    );
    // The flag must be exactly true, not a string.
    expect(isDemoUser({ email, app_metadata: { demo: "true" } })).toBe(false);
  });
});

describe("demo password", () => {
  it("is read from the environment and never defaulted", () => {
    expect(() => readDemoPassword({})).toThrow(/DEMO_PASSWORD/);
    expect(() => readDemoPassword({ DEMO_PASSWORD: "short" })).toThrow(/8/);
    expect(readDemoPassword({ DEMO_PASSWORD: "long-enough-1" })).toBe(
      "long-enough-1",
    );
  });
});

describe("assertSeedTarget", () => {
  it("allows the local stack with or without --local", () => {
    expect(assertSeedTarget("http://127.0.0.1:54321", ["--local"])).toBe(
      "local",
    );
    expect(assertSeedTarget("http://localhost:54321", [])).toBe("local");
  });
  it("calls any other address remote, and --local refuses it", () => {
    expect(assertSeedTarget("https://abc.supabase.co", [])).toBe("remote");
    expect(() =>
      assertSeedTarget("https://abc.supabase.co", ["--local"]),
    ).toThrow(/not on this machine/);
    expect(() => assertSeedTarget(undefined, ["--local"])).toThrow();
  });
  it("does not fall for look-alike hosts", () => {
    expect(assertSeedTarget("http://127.0.0.1.evil.example", [])).toBe(
      "remote",
    );
    expect(assertSeedTarget("http://localhost.evil.example:54321", [])).toBe(
      "remote",
    );
  });
});
