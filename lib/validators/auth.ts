import { z } from "zod";
import { isAdult, parseIsoDate } from "@/lib/age";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

// Supabase hashes the password; we only set sensible limits. 72 is bcrypt's cap.
const password = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use at most 72 characters.");

const dob = z
  .string()
  .refine((v) => parseIsoDate(v) !== null, "Enter a valid date of birth.")
  .refine((v) => {
    const parts = parseIsoDate(v);
    return parts === null || parts.year >= 1900;
  }, "Enter a valid date of birth.")
  .refine((v) => {
    const parts = parseIsoDate(v);
    return parts === null || isAdult(parts);
  }, "You must be at least 18 to use Shortlist.");

// HTML checkboxes arrive as "on" when ticked and are missing otherwise.
const mustTick = (message: string) =>
  z
    .string()
    .optional()
    .refine((v) => v === "on", message)
    .transform(() => true as const);

export const signupSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Tell us what to call you.")
    .max(50, "Keep it under 50 characters."),
  email,
  password,
  dob,
  acceptTerms: mustTick("Please accept the Terms to continue."),
  acceptPrivacy: mustTick("Please accept the Privacy Notice to continue."),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(72),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

export type FormState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

// Turns a failed zod parse into the shape the forms display.
export function toFormState(error: z.ZodError): FormState {
  return { fieldErrors: z.flattenError(error).fieldErrors };
}
