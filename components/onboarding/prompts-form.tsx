"use client";

import { savePromptsAction } from "@/app/profile-actions";
import { PROMPTS, PROMPT_ANSWER_MAX, PROMPT_COUNT } from "@/config/prompts";
import type { MyProfile } from "@/lib/profile";
import type { StoredPrompt } from "@/lib/validators/profile";
import { inputClass, Labelled, SelectInput } from "./inputs";
import { StepFooter } from "./step-footer";
import { useStepForm } from "./use-step-form";

export function PromptsForm({
  profile,
  next,
  label = "Save and continue",
}: {
  profile: MyProfile;
  next?: string;
  label?: string;
}) {
  const { state, pending, onSubmit } = useStepForm(savePromptsAction);
  const saved = (profile.bio_prompts ?? []) as StoredPrompt[];

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Pick {PROMPT_COUNT} different prompts and answer each in a sentence or
        two. These are what people see first.
      </p>
      {Array.from({ length: PROMPT_COUNT }, (_, i) => (
        <div key={i} className="space-y-3">
          <SelectInput
            name={`promptId_${i}`}
            label={`Prompt ${i + 1}`}
            placeholder="Choose a prompt"
            options={PROMPTS.map((p) => ({ value: p.id, label: p.text }))}
            defaultValue={saved[i]?.id}
            state={state}
          />
          <Labelled
            name={`answer_${i}`}
            label="Your answer"
            hint={`Up to ${PROMPT_ANSWER_MAX} characters.`}
            state={state}
          >
            <textarea
              id={`answer_${i}`}
              name={`answer_${i}`}
              rows={3}
              maxLength={PROMPT_ANSWER_MAX}
              defaultValue={saved[i]?.answer ?? ""}
              aria-invalid={
                state.fieldErrors?.[`answer_${i}`] ? true : undefined
              }
              className={inputClass}
            />
          </Labelled>
        </div>
      ))}
      <StepFooter state={state} pending={pending} next={next} label={label} />
    </form>
  );
}
