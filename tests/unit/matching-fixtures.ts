// Small builders shared by the matching tests.

import { MATCHING_CONFIG, type MatchingConfig } from "@/config/matching";
import { VALUES_QUESTIONS } from "@/config/values-questions";
import type {
  DropHistory,
  Gender,
  MatchUser,
  ValueAnswers,
} from "@/lib/matching/types";

export const WEEK = "2026-11-16"; // a Monday

export const config = (
  changes: Partial<MatchingConfig> = {},
): MatchingConfig => ({
  ...MATCHING_CONFIG,
  ...changes,
});

// Everyone answers option number `which` on every question, no deal-breakers,
// unless a question is listed in `overrides` (question id -> option number)
// or `dealBreakers`.
export function answers(
  which = 0,
  overrides: Record<string, number> = {},
  dealBreakers: string[] = [],
): ValueAnswers {
  const out: ValueAnswers = {};
  for (const q of VALUES_QUESTIONS) {
    const index = overrides[q.id] ?? which;
    out[q.id] = {
      answer: q.options[index % q.options.length].id,
      dealBreaker: dealBreakers.includes(q.id),
    };
  }
  return out;
}

export function user(id: string, changes: Partial<MatchUser> = {}): MatchUser {
  return {
    id,
    gender: "woman",
    interestedIn: ["man"],
    age: 26,
    city: "Pune",
    intent: "serious",
    batchYear: 2021,
    interests: ["Coffee", "Trekking", "Movies"],
    values: answers(0),
    paused: false,
    deleted: false,
    suspended: false,
    onboarded: true,
    isPlus: false,
    repliesNum: 0,
    repliesDen: 0,
    ...changes,
  };
}

export const woman = (id: string, changes: Partial<MatchUser> = {}) =>
  user(id, { gender: "woman" as Gender, interestedIn: ["man"], ...changes });

export const man = (id: string, changes: Partial<MatchUser> = {}) =>
  user(id, { gender: "man" as Gender, interestedIn: ["woman"], ...changes });

export const history = (changes: Partial<DropHistory> = {}): DropHistory => ({
  weekStart: WEEK,
  seen: [],
  blocks: [],
  connected: [],
  ...changes,
});
