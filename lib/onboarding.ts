import {
  DEAL_BREAKER_COUNT,
  VALUES_QUESTIONS,
} from "@/config/values-questions";
import { PROMPT_COUNT } from "@/config/prompts";
import { MIN_INTERESTS } from "@/config/profile-options";

// Onboarding has five steps. Nothing is stored as "current step": progress is
// worked out from what is already saved on the profile, so a person who leaves
// halfway comes back to the first step that is still incomplete.

export const STEPS = [
  "basics",
  "values",
  "prompts",
  "interests",
  "photos",
] as const;
export type Step = (typeof STEPS)[number];

export const STEP_TITLES: Record<Step, string> = {
  basics: "About you",
  values: "What matters to you",
  prompts: "In your own words",
  interests: "Your interests",
  photos: "Your photos",
};

// The profile fields the step logic needs. Matches the database columns.
export type OnboardingProfile = {
  gender: string | null;
  interested_in: string[] | null;
  city: string | null;
  intent: string | null;
  batch_year: number | null;
  occupation: string | null;
  values_answers: Record<
    string,
    { answer?: string; dealBreaker?: boolean }
  > | null;
  bio_prompts: unknown[] | null;
  interests: string[] | null;
  photos: string[] | null;
  onboarding_completed_at: string | null;
};

export function isStepComplete(step: Step, p: OnboardingProfile): boolean {
  switch (step) {
    case "basics":
      return Boolean(
        p.gender &&
        (p.interested_in?.length ?? 0) >= 1 &&
        p.city &&
        p.intent &&
        p.batch_year &&
        p.occupation,
      );
    case "values": {
      const answers = p.values_answers ?? {};
      const answered = VALUES_QUESTIONS.every((q) => answers[q.id]?.answer);
      const dealBreakers = Object.values(answers).filter(
        (a) => a?.dealBreaker,
      ).length;
      return answered && dealBreakers === DEAL_BREAKER_COUNT;
    }
    case "prompts":
      return (p.bio_prompts?.length ?? 0) >= PROMPT_COUNT;
    case "interests":
      return (p.interests?.length ?? 0) >= MIN_INTERESTS;
    case "photos":
      return (p.photos?.length ?? 0) >= 1;
  }
}

export type OnboardingState = {
  complete: boolean; // onboarding_completed_at is set
  steps: Record<Step, boolean>;
  firstIncomplete: Step | null; // null when every step is filled in
};

export function resolveOnboarding(p: OnboardingProfile): OnboardingState {
  const steps = Object.fromEntries(
    STEPS.map((s) => [s, isStepComplete(s, p)]),
  ) as Record<Step, boolean>;
  return {
    complete: Boolean(p.onboarding_completed_at),
    steps,
    firstIncomplete: STEPS.find((s) => !steps[s]) ?? null,
  };
}

// Which step to show for ?step=... A person may revisit any step up to and
// including the first incomplete one, but not skip ahead past it.
export function stepToShow(requested: unknown, state: OnboardingState): Step {
  const furthest = state.firstIncomplete ?? "photos";
  const asked = STEPS.find((s) => s === requested);
  if (!asked) return furthest;
  return STEPS.indexOf(asked) <= STEPS.indexOf(furthest) ? asked : furthest;
}

export function nextStep(step: Step): Step | null {
  return STEPS[STEPS.indexOf(step) + 1] ?? null;
}

// Where a signed-in person belongs: finished profiles go to the app,
// unfinished ones to onboarding.
export function homeRedirect(state: OnboardingState): "/onboarding" | null {
  return state.complete ? null : "/onboarding";
}

export function onboardingRedirect(state: OnboardingState): "/home" | null {
  return state.complete ? "/home" : null;
}
