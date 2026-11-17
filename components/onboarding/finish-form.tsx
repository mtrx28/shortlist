"use client";

import { finishOnboardingAction } from "@/app/profile-actions";
import { useStepForm } from "./use-step-form";
import { StepFooter } from "./step-footer";

// The very last button of onboarding. The server checks everything is filled in.
export function FinishForm({ hasPhoto }: { hasPhoto: boolean }) {
  const { state, pending, onSubmit } = useStepForm(finishOnboardingAction);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {!hasPhoto && (
        <p className="text-muted-foreground text-sm">
          Add at least one photo to finish.
        </p>
      )}
      <StepFooter
        state={state}
        pending={pending}
        disabled={!hasPhoto}
        label="Finish"
      />
    </form>
  );
}
