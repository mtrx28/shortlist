"use client";

import { saveBasicsAction } from "@/app/profile-actions";
import {
  BATCH_YEARS,
  CITIES,
  COLLEGE_TIERS,
  GENDERS,
  INTENTS,
} from "@/config/profile-options";
import type { MyProfile } from "@/lib/profile";
import { Choices, SelectInput, TextInput } from "./inputs";
import { StepFooter } from "./step-footer";
import { useStepForm } from "./use-step-form";

export function BasicsForm({
  profile,
  next,
  label = "Save and continue",
}: {
  profile: MyProfile;
  next?: string;
  label?: string;
}) {
  const { state, pending, onSubmit } = useStepForm(saveBasicsAction);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <TextInput
        name="displayName"
        label="First name"
        defaultValue={profile.display_name}
        maxLength={50}
        state={state}
      />
      <Choices
        name="gender"
        legend="I am a"
        type="radio"
        options={[...GENDERS]}
        defaults={profile.gender ? [profile.gender] : []}
        chips
        state={state}
      />
      <Choices
        name="interestedIn"
        legend="I would like to meet"
        type="checkbox"
        options={[...GENDERS]}
        defaults={profile.interested_in ?? []}
        hint="Pick all that apply."
        chips
        state={state}
      />
      <SelectInput
        name="city"
        label="City"
        placeholder="Choose your city"
        options={CITIES.map((c) => ({ value: c, label: c }))}
        defaultValue={profile.city}
        hint="We are starting in these cities."
        state={state}
      />
      <Choices
        name="intent"
        legend="What are you looking for?"
        type="radio"
        options={[...INTENTS]}
        defaults={profile.intent ? [profile.intent] : []}
        state={state}
      />
      <SelectInput
        name="batchYear"
        label="pH batch year"
        placeholder="Choose your batch"
        options={BATCH_YEARS.map((y) => ({ value: y, label: String(y) }))}
        defaultValue={profile.batch_year}
        state={state}
      />
      <TextInput
        name="occupation"
        label="What do you do?"
        defaultValue={profile.occupation}
        maxLength={100}
        hint="For example: Software engineer, Analyst, Teacher."
        state={state}
      />
      <SelectInput
        name="collegeTier"
        label="College tier (optional)"
        placeholder="Skip"
        options={COLLEGE_TIERS.map((t) => ({ value: t.value, label: t.label }))}
        defaultValue={profile.college_tier}
        hint="A rough bucket only. We never ask for the college name."
        state={state}
      />
      <StepFooter state={state} pending={pending} next={next} label={label} />
    </form>
  );
}
