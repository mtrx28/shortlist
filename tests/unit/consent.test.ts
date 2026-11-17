import { describe, expect, it } from "vitest";
import { POLICY_VERSION, buildSignupMetadata } from "@/lib/consent";
import { safeNextPath } from "@/lib/safe-redirect";

describe("buildSignupMetadata", () => {
  it("carries the consent flags and the current policy version", () => {
    const meta = buildSignupMetadata({
      displayName: "Asha",
      dob: "1999-05-01",
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    expect(meta).toEqual({
      display_name: "Asha",
      dob: "1999-05-01",
      accepted_terms: true,
      accepted_privacy: true,
      consent_version: POLICY_VERSION,
    });
  });
  it("never includes a role", () => {
    const meta = buildSignupMetadata({
      displayName: "A",
      dob: "1999-05-01",
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    expect(meta).not.toHaveProperty("role");
  });
});

describe("safeNextPath", () => {
  it("keeps local paths", () => {
    expect(safeNextPath("/shortlist?x=1")).toBe("/shortlist?x=1");
  });
  it("falls back for other sites and odd input", () => {
    expect(safeNextPath("https://evil.example")).toBe("/home");
    expect(safeNextPath("//evil.example")).toBe("/home");
    expect(safeNextPath("/\\evil.example")).toBe("/home");
    expect(safeNextPath(undefined)).toBe("/home");
    expect(safeNextPath(null)).toBe("/home");
  });
});
