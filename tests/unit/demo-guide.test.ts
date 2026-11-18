import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_LOGINS, demoEmail } from "@/config/demo";
import { readDemoGuideState } from "@/lib/demo-guide";
import { buildDemoProfiles } from "../../scripts/seed/demo-data";

describe("readDemoGuideState", () => {
  it("does not show a password unless DEMO_PASSWORD_PUBLIC is set", () => {
    expect(readDemoGuideState({}).publicPassword).toBeNull();
    // The seed secret is a different variable and is never shown.
    expect(
      readDemoGuideState({ DEMO_PASSWORD: "super-secret-1" }).publicPassword,
    ).toBeNull();
  });
  it("shows it when the owner publishes it, and ignores a too-short value", () => {
    expect(
      readDemoGuideState({ DEMO_PASSWORD_PUBLIC: " demo-pass-123 " })
        .publicPassword,
    ).toBe("demo-pass-123");
    expect(
      readDemoGuideState({ DEMO_PASSWORD_PUBLIC: "short" }).publicPassword,
    ).toBeNull();
  });
  it("reports the demo controls and payment mode honestly", () => {
    expect(readDemoGuideState({}).controlsOn).toBe(false);
    expect(readDemoGuideState({ DEMO_CONTROLS: "true" }).controlsOn).toBe(true);
    expect(
      readDemoGuideState({ SUPABASE_SERVICE_ROLE_KEY: "service-key" }).payments,
    ).toBe("simulated");
    // A missing service key makes the simulated checkout unusable: say so.
    expect(readDemoGuideState({}).payments).toBe("not_configured");
    expect(readDemoGuideState({ RAZORPAY_KEY_ID: "rzp_test_x" }).payments).toBe(
      "not_configured",
    );
    expect(
      readDemoGuideState({
        RAZORPAY_KEY_ID: "rzp_test_x",
        RAZORPAY_KEY_SECRET: "s",
      }).payments,
    ).toBe("test");
  });
});

describe("the published logins", () => {
  it("all exist in the seed data, on the demo domain", () => {
    const handles = new Set(
      buildDemoProfiles().map((p: { handle: string }) => p.handle),
    );
    for (const login of DEMO_LOGINS) {
      expect(handles.has(login.handle), login.handle).toBe(true);
      expect(demoEmail(login.handle)).toMatch(/@demo\.shortlist\.test$/);
    }
  });
  it("never puts a password in the config", () => {
    const text = readFileSync("config/demo.ts", "utf8");
    expect(text).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/i);
  });
});
