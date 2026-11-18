"use client";

import { useActionState } from "react";
import { contactAction } from "@/app/grievance/actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import type { FormState } from "@/lib/validators/auth";

export function ContactForm() {
  const [state, action] = useActionState<FormState, FormData>(
    contactAction,
    {},
  );
  const messageErrors = state.fieldErrors?.message;
  return (
    <form action={action} className="space-y-4">
      <Field name="name" label="Your name" autoComplete="name" state={state} />
      <Field
        name="email"
        label="Your email"
        type="email"
        autoComplete="email"
        hint="We reply here."
        state={state}
      />
      <div className="space-y-1">
        <label htmlFor="message" className="text-sm font-medium">
          Your message
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          maxLength={2000}
          required
          aria-invalid={messageErrors ? true : undefined}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        {messageErrors?.map((m) => (
          <p key={m} className="text-destructive text-xs" role="alert">
            {m}
          </p>
        ))}
      </div>
      <FormMessage state={state} />
      <SubmitButton>Send</SubmitButton>
    </form>
  );
}
