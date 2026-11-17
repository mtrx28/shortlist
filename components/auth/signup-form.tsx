"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signupAction } from "@/app/(auth)/actions";
import type { FormState } from "@/lib/validators/auth";
import { CheckboxField, Field, FormMessage, SubmitButton } from "./form-bits";

export function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signupAction, {});
  // The browser's date picker stops at today. The server re-checks the age.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-4">
      <Field
        name="displayName"
        label="First name"
        autoComplete="given-name"
        state={state}
      />
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        state={state}
      />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        state={state}
      />
      <Field
        name="dob"
        label="Date of birth"
        type="date"
        max={today}
        autoComplete="bday"
        hint="You must be 18 or older. We use this only to check your age."
        state={state}
      />
      <CheckboxField name="acceptTerms" state={state}>
        I agree to the{" "}
        <Link href="/terms" className="underline" target="_blank">
          Terms
        </Link>
        .
      </CheckboxField>
      <CheckboxField name="acceptPrivacy" state={state}>
        I have read the{" "}
        <Link href="/privacy" className="underline" target="_blank">
          Privacy Notice
        </Link>{" "}
        and agree to my data being used as it describes.
      </CheckboxField>
      <FormMessage state={state} />
      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}
