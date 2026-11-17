import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/auth/form-bits";
import type { FormState } from "@/lib/validators/auth";

// The bottom of every step form: the hidden "where next" field, any
// form-level message, and the save button.
export function StepFooter({
  state,
  pending,
  next,
  label,
  disabled,
}: {
  state: FormState;
  pending: boolean;
  next?: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {next && <input type="hidden" name="next" value={next} />}
      <FormMessage state={state} />
      <Button
        type="submit"
        size="lg"
        disabled={pending || disabled}
        className="w-full"
      >
        {pending ? "Saving..." : label}
      </Button>
    </div>
  );
}
