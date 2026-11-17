import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/validators/auth";

// A date of birth that is safely over 18 whenever this test runs.
const adultDob = "1995-04-10";

const validSignup = {
  displayName: "Asha",
  email: "Asha@Example.com ",
  password: "correct horse battery",
  dob: adultDob,
  acceptTerms: "on",
  acceptPrivacy: "on",
};

describe("signupSchema", () => {
  it("accepts a valid signup and normalises the email", () => {
    const result = signupSchema.safeParse(validSignup);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("asha@example.com");
      expect(result.data.acceptTerms).toBe(true);
    }
  });

  it("rejects someone under 18", () => {
    const year = new Date().getUTCFullYear() - 10;
    const result = signupSchema.safeParse({
      ...validSignup,
      dob: `${year}-01-01`,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing or impossible date of birth", () => {
    expect(signupSchema.safeParse({ ...validSignup, dob: "" }).success).toBe(
      false,
    );
    expect(
      signupSchema.safeParse({ ...validSignup, dob: "1999-02-30" }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...validSignup, dob: "1850-01-01" }).success,
    ).toBe(false);
  });

  it("requires both consents", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, acceptTerms: undefined })
        .success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...validSignup, acceptPrivacy: "" }).success,
    ).toBe(false);
  });

  it("rejects short passwords and bad emails", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, password: "short" }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...validSignup, email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("rejects an empty or overlong name", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, displayName: "  " }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...validSignup, displayName: "x".repeat(51) })
        .success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("needs an email and a password", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "x" }).success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "" }).success,
    ).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("needs a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(
      true,
    );
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    const ok = {
      password: "a long enough one",
      confirmPassword: "a long enough one",
    };
    expect(resetPasswordSchema.safeParse(ok).success).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        ...ok,
        confirmPassword: "different one!!",
      }).success,
    ).toBe(false);
  });
});
