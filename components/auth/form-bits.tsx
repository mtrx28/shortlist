"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/validators/auth";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// A labelled input with its validation message underneath.
export function Field(props: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  state: FormState;
  max?: string;
}) {
  const errors = props.state.fieldErrors?.[props.name];
  return (
    <div className="space-y-1">
      <label htmlFor={props.name} className="text-sm font-medium">
        {props.label}
      </label>
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        max={props.max}
        required
        aria-invalid={errors ? true : undefined}
        className={inputClass}
      />
      {props.hint && !errors && (
        <p className="text-muted-foreground text-xs">{props.hint}</p>
      )}
      {errors?.map((message) => (
        <p key={message} className="text-destructive text-xs" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}

export function CheckboxField(props: {
  name: string;
  state: FormState;
  children: React.ReactNode;
}) {
  const errors = props.state.fieldErrors?.[props.name];
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name={props.name} className="mt-1" />
        <span>{props.children}</span>
      </label>
      {errors?.map((message) => (
        <p key={message} className="text-destructive text-xs" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Please wait..." : children}
    </Button>
  );
}

// Shows the form-level error or success message.
export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return <p className="text-sm">{state.message}</p>;
  }
  return null;
}
