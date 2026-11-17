"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/(auth)/actions";
import type { FormState } from "@/lib/validators/auth";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
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
        autoComplete="current-password"
        state={state}
      />
      <FormMessage state={state} />
      <SubmitButton>Log in</SubmitButton>
      <p className="text-sm">
        <Link href="/forgot-password" className="underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
