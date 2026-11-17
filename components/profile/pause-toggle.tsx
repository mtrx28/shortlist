"use client";

import { setPausedAction } from "@/app/profile-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/auth/form-bits";
import { useStepForm } from "@/components/onboarding/use-step-form";

// Pause hides you from future shortlists. Nothing is deleted.
export function PauseToggle({ paused }: { paused: boolean }) {
  const { state, pending, onSubmit } = useStepForm(setPausedAction);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm">
        {paused
          ? "Your profile is paused. You are not in anyone's shortlist."
          : "Your profile is active. Pause it if you need a break; nothing is deleted."}
      </p>
      <input type="hidden" name="paused" value={paused ? "false" : "true"} />
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {paused ? "Unpause my profile" : "Pause my profile"}
      </Button>
    </form>
  );
}
