"use client";

import { saveValuesAction } from "@/app/profile-actions";
import {
  DEAL_BREAKER_COUNT,
  VALUES_QUESTIONS,
} from "@/config/values-questions";
import type { MyProfile } from "@/lib/profile";
import { Choices, FieldErrors } from "./inputs";
import { StepFooter } from "./step-footer";
import { useStepForm } from "./use-step-form";

export function ValuesForm({
  profile,
  next,
  label = "Save and continue",
}: {
  profile: MyProfile;
  next?: string;
  label?: string;
}) {
  const { state, pending, onSubmit } = useStepForm(saveValuesAction);
  const saved = profile.values_answers ?? {};
  const savedDeal = VALUES_QUESTIONS.filter(
    (q) => saved[q.id]?.dealBreaker,
  ).map((q) => q.id);

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Answer all {VALUES_QUESTIONS.length}. Then tick exactly{" "}
        {DEAL_BREAKER_COUNT} answers that are deal-breakers: someone who would
        answer differently is not for you.
      </p>
      {VALUES_QUESTIONS.map((q) => (
        <div key={q.id} className="space-y-2">
          <Choices
            name={`q_${q.id}`}
            legend={q.text}
            type="radio"
            options={q.options.map((o) => ({ value: o.id, label: o.label }))}
            defaults={saved[q.id]?.answer ? [saved[q.id].answer as string] : []}
            state={state}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="dealBreakers"
              value={q.id}
              defaultChecked={savedDeal.includes(q.id)}
            />
            Deal-breaker for me
          </label>
        </div>
      ))}
      <FieldErrors state={state} name="dealBreakers" />
      <StepFooter state={state} pending={pending} next={next} label={label} />
    </form>
  );
}
