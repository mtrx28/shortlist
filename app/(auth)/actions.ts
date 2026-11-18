"use server";

import { redirect } from "next/navigation";
import { getAppUrl, getSupabaseEnv } from "@/lib/env";
import { buildSignupMetadata } from "@/lib/consent";
import { logEvent } from "@/lib/events";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import {
  echoFields,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  toFormState,
  type FormState,
} from "@/lib/validators/auth";

const NOT_CONFIGURED: FormState = {
  error: "Sign-in is not set up on this server yet.",
};

// Server actions run only on the server. Every input is validated with Zod
// here, whatever the browser did, because anyone can post to these endpoints.

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const typed = echoFields(formData, ["displayName", "email", "dob"]);
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error, typed);

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  const { email, password, displayName, dob, acceptTerms, acceptPrivacy } =
    parsed.data;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getAppUrl()}/auth/confirm?next=/home`,
      data: buildSignupMetadata({
        displayName,
        dob,
        acceptedTerms: acceptTerms,
        acceptedPrivacy: acceptPrivacy,
      }),
    },
  });

  if (error) {
    // The database also refuses under-18s and missing consent. We already
    // checked both above, so anything reaching here is a general failure.
    return {
      error: "We could not create your account. Please try again.",
      values: typed,
    };
  }

  await logEvent("signup", data.user?.id ?? null);
  // Same page whether or not the email was already registered, so the form
  // cannot be used to discover who has an account.
  redirect("/check-email");
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const typed = echoFields(formData, ["email"]);
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error, typed);

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        error: "Please confirm your email first. Check your inbox.",
        values: typed,
      };
    }
    // One message for wrong email and wrong password.
    return { error: "Email or password is incorrect.", values: typed };
  }

  await logEvent("login", data.user.id);
  redirect(safeNextPath(formData.get("next")));
}

export async function logoutAction() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getAppUrl()}/auth/confirm?next=/reset-password`,
  });

  // Always the same answer, so the form does not reveal which emails exist.
  return {
    message:
      "If that email has an account, we have sent a link to reset the password.",
  };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  if (!getSupabaseEnv()) return NOT_CONFIGURED;
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  // The reset link signed the person in; without that session this fails.
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return {
      error: "The reset link has expired. Please request a new one.",
    };
  }

  redirect("/home");
}
