import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashPhId,
  isDemoAutoVerify,
  normalisePhId,
  phIdSchema,
} from "@/lib/elitmus";

describe("pH ID format", () => {
  it("ignores case, spaces and dashes", () => {
    expect(normalisePhId(" ph-12 34 ab ")).toBe("PH1234AB");
    expect(phIdSchema.parse("ph-123456")).toBe("PH123456");
  });

  it.each([
    "",
    "12345",
    "ab cd",
    "has_underscore1",
    "x".repeat(15),
    "ph#12345",
  ])("rejects %j", (value) => {
    expect(phIdSchema.safeParse(value).success).toBe(false);
  });

  it("gives a friendly message", () => {
    const r = phIdSchema.safeParse("12");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/6 to 14/);
  });
});

describe("hashPhId", () => {
  it("is stable and does not contain the ID", () => {
    const h = hashPhId("PH123456", "secret-a");
    expect(h).toBe(hashPhId("PH123456", "secret-a"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h.toLowerCase()).not.toContain("ph123456");
  });

  it("treats formatting differences as the same ID", () => {
    expect(hashPhId("ph-123 456", "s")).toBe(hashPhId("PH123456", "s"));
  });

  it("changes with the ID and with the secret", () => {
    expect(hashPhId("PH123456", "s")).not.toBe(hashPhId("PH123457", "s"));
    expect(hashPhId("PH123456", "s1")).not.toBe(hashPhId("PH123456", "s2"));
  });
});

describe("isDemoAutoVerify", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off by default and for anything except exactly true", () => {
    vi.stubEnv("DEMO_AUTO_VERIFY", "");
    expect(isDemoAutoVerify()).toBe(false);
    vi.stubEnv("DEMO_AUTO_VERIFY", "false");
    expect(isDemoAutoVerify()).toBe(false);
    vi.stubEnv("DEMO_AUTO_VERIFY", "TRUE");
    expect(isDemoAutoVerify()).toBe(false);
    vi.stubEnv("DEMO_AUTO_VERIFY", "true");
    expect(isDemoAutoVerify()).toBe(true);
  });
});
