"use client";

import { useActionState } from "react";
import { deleteAccountAction } from "@/app/account/delete/actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import type { FormState } from "@/lib/validators/auth";

export function DeleteForm({ phrase }: { phrase: string }) {
  const [state, action] = useActionState<FormState, FormData>(
    deleteAccountAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <Field
        name="password"
        label="Your password"
        type="password"
        autoComplete="current-password"
        hint="We ask again to be sure it is really you."
        state={state}
      />
      <Field
        name="confirm"
        label={`Type ${phrase} to confirm`}
        autoComplete="off"
        state={state}
      />
      <FormMessage state={state} />
      <SubmitButton>Delete my account for good</SubmitButton>
    </form>
  );
}
