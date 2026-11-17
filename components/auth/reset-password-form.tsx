"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/(auth)/actions";
import type { FormState } from "@/lib/validators/auth";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function ResetPasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(
    resetPasswordAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        state={state}
      />
      <Field
        name="confirmPassword"
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        state={state}
      />
      <FormMessage state={state} />
      <SubmitButton>Set new password</SubmitButton>
    </form>
  );
}
