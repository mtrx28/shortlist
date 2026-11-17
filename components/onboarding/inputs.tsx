import type { FormState } from "@/lib/validators/auth";

// Small form pieces shared by the onboarding steps and the profile page.
// They are plain HTML inputs (no extra library), sized for thumbs on a phone.

export const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";

export function FieldErrors({
  state,
  name,
}: {
  state: FormState;
  name: string;
}) {
  const errors = state.fieldErrors?.[name];
  if (!errors) return null;
  return (
    <>
      {errors.map((message) => (
        <p key={message} className="text-destructive text-xs" role="alert">
          {message}
        </p>
      ))}
    </>
  );
}

export function Labelled({
  name,
  label,
  hint,
  state,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  state: FormState;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !state.fieldErrors?.[name] && (
        <p className="text-muted-foreground text-xs">{hint}</p>
      )}
      <FieldErrors state={state} name={name} />
    </div>
  );
}

export function TextInput(props: {
  name: string;
  label: string;
  defaultValue?: string | null;
  hint?: string;
  maxLength?: number;
  state: FormState;
}) {
  const invalid = Boolean(props.state.fieldErrors?.[props.name]);
  return (
    <Labelled {...props}>
      <input
        id={props.name}
        name={props.name}
        defaultValue={props.defaultValue ?? ""}
        maxLength={props.maxLength}
        aria-invalid={invalid || undefined}
        className={inputClass}
      />
    </Labelled>
  );
}

export function SelectInput(props: {
  name: string;
  label: string;
  placeholder: string;
  options: { value: string | number; label: string }[];
  defaultValue?: string | number | null;
  hint?: string;
  state: FormState;
}) {
  const invalid = Boolean(props.state.fieldErrors?.[props.name]);
  return (
    <Labelled {...props}>
      <select
        id={props.name}
        name={props.name}
        defaultValue={props.defaultValue ?? ""}
        aria-invalid={invalid || undefined}
        className={inputClass}
      >
        <option value="">{props.placeholder}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Labelled>
  );
}

// A group of radio buttons or checkboxes drawn as tappable pills/cards.
export function Choices(props: {
  name: string;
  legend: string;
  type: "radio" | "checkbox";
  options: { value: string; label: string; hint?: string }[];
  defaults?: string[];
  hint?: string;
  chips?: boolean; // small inline pills instead of full-width rows
  state: FormState;
}) {
  const invalid = Boolean(props.state.fieldErrors?.[props.name]);
  return (
    <fieldset className="space-y-2" aria-invalid={invalid || undefined}>
      <legend className="text-sm font-medium">{props.legend}</legend>
      <div className={props.chips ? "flex flex-wrap gap-2" : "space-y-2"}>
        {props.options.map((o) => (
          <label
            key={o.value}
            className={
              "border-input has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5 text-sm has-[:focus-visible]:ring-2 " +
              (props.chips ? "rounded-full" : "")
            }
          >
            <input
              type={props.type}
              name={props.name}
              value={o.value}
              defaultChecked={props.defaults?.includes(o.value)}
              className="sr-only"
            />
            <span>
              {o.label}
              {o.hint && (
                <span className="block text-xs opacity-80">{o.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      {props.hint && !invalid && (
        <p className="text-muted-foreground text-xs">{props.hint}</p>
      )}
      <FieldErrors state={props.state} name={props.name} />
    </fieldset>
  );
}
