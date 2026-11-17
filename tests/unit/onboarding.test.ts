import { describe, expect, it } from "vitest";
import { VALUES_QUESTIONS } from "@/config/values-questions";
import {
  homeRedirect,
  isStepComplete,
  nextStep,
  onboardingRedirect,
  resolveOnboarding,
  stepToShow,
  STEPS,
  type OnboardingProfile,
} from "@/lib/onboarding";

const empty: OnboardingProfile = {
  gender: null,
  interested_in: [],
  city: null,
  intent: null,
  batch_year: null,
  occupation: null,
  values_answers: {},
  bio_prompts: [],
  interests: [],
  photos: [],
  onboarding_completed_at: null,
};

const basics = {
  gender: "woman",
  interested_in: ["man"],
  city: "Pune",
  intent: "serious",
  batch_year: 2022,
  occupation: "Analyst",
};

function allValues(deal = ["kids", "family"]) {
  return Object.fromEntries(
    VALUES_QUESTIONS.map((q) => [
      q.id,
      { answer: q.options[0].id, dealBreaker: deal.includes(q.id) },
    ]),
  );
}

const complete: OnboardingProfile = {
  ...empty,
  ...basics,
  values_answers: allValues(),
  bio_prompts: [{}, {}, {}],
  interests: ["Cricket", "Coffee", "Travel"],
  photos: ["a/b.webp"],
  onboarding_completed_at: "2026-11-18T10:00:00Z",
};

describe("isStepComplete", () => {
  it("is false for everything on a fresh profile", () => {
    for (const step of STEPS) expect(isStepComplete(step, empty)).toBe(false);
  });

  it("needs every basics field except college tier", () => {
    const p = { ...empty, ...basics };
    expect(isStepComplete("basics", p)).toBe(true);
    for (const key of Object.keys(basics)) {
      const broken = {
        ...p,
        [key]: Array.isArray(p[key as "interested_in"]) ? [] : null,
      };
      expect(isStepComplete("basics", broken), key).toBe(false);
    }
  });

  it("needs all 8 answers and exactly 2 deal-breakers", () => {
    expect(
      isStepComplete("values", { ...empty, values_answers: allValues() }),
    ).toBe(true);
    const missing = allValues();
    delete missing.money;
    expect(
      isStepComplete("values", { ...empty, values_answers: missing }),
    ).toBe(false);
    expect(
      isStepComplete("values", {
        ...empty,
        values_answers: allValues(["kids"]),
      }),
    ).toBe(false);
    expect(
      isStepComplete("values", {
        ...empty,
        values_answers: allValues(["kids", "family", "money"]),
      }),
    ).toBe(false);
  });

  it("needs 3 prompts, 3 interests and 1 photo", () => {
    expect(isStepComplete("prompts", { ...empty, bio_prompts: [{}, {}] })).toBe(
      false,
    );
    expect(
      isStepComplete("prompts", { ...empty, bio_prompts: [{}, {}, {}] }),
    ).toBe(true);
    expect(
      isStepComplete("interests", { ...empty, interests: ["a", "b"] }),
    ).toBe(false);
    expect(
      isStepComplete("interests", { ...empty, interests: ["a", "b", "c"] }),
    ).toBe(true);
    expect(isStepComplete("photos", { ...empty, photos: ["x"] })).toBe(true);
  });

  it("copes with null arrays", () => {
    const nulls = {
      ...empty,
      interested_in: null,
      values_answers: null,
      bio_prompts: null,
      interests: null,
      photos: null,
    };
    for (const step of STEPS) expect(isStepComplete(step, nulls)).toBe(false);
  });
});

describe("resolveOnboarding", () => {
  it("starts at basics for a new user", () => {
    const s = resolveOnboarding(empty);
    expect(s.complete).toBe(false);
    expect(s.firstIncomplete).toBe("basics");
  });

  it("resumes at the first incomplete step", () => {
    expect(resolveOnboarding({ ...empty, ...basics }).firstIncomplete).toBe(
      "values",
    );
    const s = resolveOnboarding({
      ...empty,
      ...basics,
      values_answers: allValues(),
      bio_prompts: [{}, {}, {}],
    });
    expect(s.firstIncomplete).toBe("interests");
    expect(s.steps).toMatchObject({
      basics: true,
      values: true,
      prompts: true,
    });
  });

  it("is complete only when the completed flag is set", () => {
    const filledButNotFinished = { ...complete, onboarding_completed_at: null };
    const s = resolveOnboarding(filledButNotFinished);
    expect(s.firstIncomplete).toBeNull();
    expect(s.complete).toBe(false);
    expect(resolveOnboarding(complete).complete).toBe(true);
  });
});

describe("stepToShow", () => {
  const state = resolveOnboarding({ ...empty, ...basics }); // first incomplete: values

  it("defaults to the first incomplete step", () => {
    expect(stepToShow(undefined, state)).toBe("values");
    expect(stepToShow("nonsense", state)).toBe("values");
  });

  it("lets people go back but not skip ahead", () => {
    expect(stepToShow("basics", state)).toBe("basics");
    expect(stepToShow("values", state)).toBe("values");
    expect(stepToShow("photos", state)).toBe("values");
  });

  it("shows the last step when everything is filled in", () => {
    const done = resolveOnboarding({
      ...complete,
      onboarding_completed_at: null,
    });
    expect(stepToShow(undefined, done)).toBe("photos");
  });
});

describe("step order and redirects", () => {
  it("knows the next step", () => {
    expect(nextStep("basics")).toBe("values");
    expect(nextStep("interests")).toBe("photos");
    expect(nextStep("photos")).toBeNull();
  });

  it("sends unfinished users to onboarding and finished users away from it", () => {
    const unfinished = resolveOnboarding(empty);
    const finished = resolveOnboarding(complete);
    expect(homeRedirect(unfinished)).toBe("/onboarding");
    expect(homeRedirect(finished)).toBeNull();
    expect(onboardingRedirect(unfinished)).toBeNull();
    expect(onboardingRedirect(finished)).toBe("/home");
  });
});
