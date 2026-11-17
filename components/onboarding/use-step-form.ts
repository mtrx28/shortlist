"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { FormState } from "@/lib/validators/auth";

type StepAction = (prev: FormState, form: FormData) => Promise<FormState>;

// Runs a server action when the form is submitted, and keeps what the person
// typed on screen if the server sends back an error. (React's built-in form
// "action" prop clears the fields after every submit, which is annoying when
// there is a validation message to fix.)
export function useStepForm(action: StepAction) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await action(state, form));
    });
  }

  return { state, pending, onSubmit };
}
