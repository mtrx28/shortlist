"use client";

import { saveInterestsAction } from "@/app/profile-actions";
import {
  INTERESTS,
  MAX_INTERESTS,
  MIN_INTERESTS,
} from "@/config/profile-options";
import type { MyProfile } from "@/lib/profile";
import { Choices } from "./inputs";
import { StepFooter } from "./step-footer";
import { useStepForm } from "./use-step-form";

export function InterestsForm({
  profile,
  next,
  label = "Save and continue",
}: {
  profile: MyProfile;
  next?: string;
  label?: string;
}) {
  const { state, pending, onSubmit } = useStepForm(saveInterestsAction);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Choices
        name="interests"
        legend={`Pick ${MIN_INTERESTS} to ${MAX_INTERESTS}`}
        type="checkbox"
        options={INTERESTS.map((i) => ({ value: i, label: i }))}
        defaults={profile.interests ?? []}
        chips
        state={state}
      />
      <StepFooter state={state} pending={pending} next={next} label={label} />
    </form>
  );
}
