// The "why we matched" breakdown that Plus members see. Free members see the
// top two reasons (reasons.ts); Plus members also see every topic they agree on
// and how close the match is overall.
//
// Privacy rules, the same as for the short reasons:
//   * only TOPICS are named ("how close you stay to family"), never what the
//     other person answered;
//   * their deal-breaker flags are never used or shown;
//   * the overall closeness is a word (strong, good, some), not a number, and
//     is worked out from the parts both people can see (values, interests,
//     batch, intent), not from reply rates or how often someone was shown.

import { VALUE_TOPICS, type MatchingConfig } from "@/config/matching";
import { scorePair, sharedInterests } from "./score";
import type { Intent, Member } from "./types";

export type MatchBand = "strong" | "good" | "some";

export type MatchDetail = {
  band: MatchBand;
  bandText: string;
  lines: { label: string; text: string }[];
};

// Where the words change. Both parts are about the 0 to 1 score.
export const BAND_LIMITS = { strong: 0.7, good: 0.5 } as const;

const INTENT_TEXT: Record<Intent, string> = {
  serious: "a serious relationship",
  open_to_see: "seeing where things go",
  friendships_first: "friendship first",
};

function words(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function bandFor(score: number): MatchBand {
  if (score >= BAND_LIMITS.strong) return "strong";
  if (score >= BAND_LIMITS.good) return "good";
  return "some";
}

const BAND_TEXT: Record<MatchBand, string> = {
  strong: "A strong match on what you can both see",
  good: "A good match on what you can both see",
  some: "Some common ground, and a few differences",
};

export function buildMatchDetail(
  viewer: Member,
  candidate: Member,
  config: MatchingConfig,
): MatchDetail {
  // Only the parts both people can see count toward the word.
  const w = config.weights;
  const parts = scorePair(viewer, candidate, 0, config);
  const visibleWeight = w.values + w.interests + w.lifeStage + w.intent;
  const visible =
    (w.values * parts.values +
      w.interests * parts.interests +
      w.lifeStage * parts.lifeStage +
      w.intent * parts.intent) /
    visibleWeight;
  const band = bandFor(visible);

  const lines: { label: string; text: string }[] = [];

  const asked = Object.keys(viewer.values).filter(
    (id) => candidate.values[id],
  ).length;
  const topics = parts.matchedQuestions
    .filter((id) => VALUE_TOPICS[id])
    .map((id) => VALUE_TOPICS[id]);
  if (asked > 0) {
    lines.push({
      label: "Values",
      text:
        topics.length > 0
          ? `You answered alike on ${topics.length} of ${asked} topics: ${words(topics)}.`
          : `You answered differently on all ${asked} topics, so this one is about other things.`,
    });
  }

  const shared = sharedInterests(viewer, candidate);
  lines.push({
    label: "Interests",
    text:
      shared.length > 0
        ? `You both enjoy ${words(shared)}.`
        : "No interest tags in common yet.",
  });

  const gap = Math.abs(viewer.batchYear - candidate.batchYear);
  lines.push({
    label: "Life stage",
    text:
      gap === 0
        ? "You are from the same pH batch."
        : gap <= config.lifeStageMaxGap
          ? "You are from nearby pH batches."
          : "Your pH batches are a few years apart.",
  });

  lines.push({
    label: "Looking for",
    text:
      viewer.intent === candidate.intent
        ? `You are both looking for ${INTENT_TEXT[viewer.intent]}.`
        : `You are looking for ${INTENT_TEXT[viewer.intent]}; they are looking for ${INTENT_TEXT[candidate.intent]}.`,
  });

  lines.push({ label: "City", text: `You are both in ${candidate.city}.` });

  return { band, bandText: BAND_TEXT[band], lines };
}
