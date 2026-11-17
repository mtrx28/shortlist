"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import type { FormState } from "@/lib/validators/auth";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function ForgotPasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(
    forgotPasswordAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        state={state}
      />
      <FormMessage state={state} />
      <SubmitButton>Send reset link</SubmitButton>
    </form>
  );
}
