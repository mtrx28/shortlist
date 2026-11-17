import { describe, expect, it } from "vitest";
import {
  BATCH_YEARS,
  CITIES,
  INTERESTS,
  MAX_INTERESTS,
  MIN_INTERESTS,
} from "@/config/profile-options";
import { PROMPTS, PROMPT_COUNT } from "@/config/prompts";
import {
  DEAL_BREAKER_COUNT,
  VALUES_QUESTIONS,
} from "@/config/values-questions";

// The database function complete_onboarding() hard-codes 8 answers, 3 prompts,
// 3 interests. These tests fail if the config drifts away from it.
describe("config matches the database rules", () => {
  it("has 8 values questions, 2 deal-breakers, 3 prompts, 3+ interests", () => {
    expect(VALUES_QUESTIONS).toHaveLength(8);
    expect(DEAL_BREAKER_COUNT).toBe(2);
    expect(PROMPT_COUNT).toBe(3);
    expect(MIN_INTERESTS).toBe(3);
    expect(MAX_INTERESTS).toBeLessThanOrEqual(10);
  });

  it("has unique ids everywhere", () => {
    const unique = (list: string[]) => new Set(list).size === list.length;
    expect(unique(VALUES_QUESTIONS.map((q) => q.id))).toBe(true);
    for (const q of VALUES_QUESTIONS) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(unique(q.options.map((o) => o.id))).toBe(true);
    }
    expect(unique(PROMPTS.map((p) => p.id))).toBe(true);
    expect(unique([...INTERESTS])).toBe(true);
    expect(unique([...CITIES])).toBe(true);
    expect(PROMPTS.length).toBeGreaterThanOrEqual(PROMPT_COUNT);
  });

  it("offers the launch batches", () => {
    expect([...BATCH_YEARS]).toEqual([2020, 2021, 2022, 2023]);
  });
});
