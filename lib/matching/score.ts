// Scoring: how good is this pair? Each part is a number from 0 to 1; the
// config weights (which add up to 1) combine them into one score from 0 to 1.
// The score is for "viewer is shown candidate". Most parts are the same in
// both directions; responsiveness and freshness are about the candidate.

import type { MatchingConfig } from "@/config/matching";
import { intentScore } from "./filters";
import type { Member, ScoreBreakdown } from "./types";

// Share of the values questions answered the same way. A question counts
// double (config.dealBreakerWeight) when either person marked it as a
// deal-breaker, so agreeing on what matters most counts for more. Also returns
// which questions matched, for the reasons.
export function valuesSimilarity(
  viewer: Member,
  candidate: Member,
  config: MatchingConfig,
): { score: number; matched: string[] } {
  let total = 0;
  let same = 0;
  const matched: string[] = [];
  for (const [id, mine] of Object.entries(viewer.values)) {
    const theirs = candidate.values[id];
    if (!theirs) continue; // only compare questions both answered
    const weight =
      mine.dealBreaker || theirs.dealBreaker ? config.dealBreakerWeight : 1;
    total += weight;
    if (mine.answer === theirs.answer) {
      same += weight;
      matched.push(id);
    }
  }
  return { score: total === 0 ? 0 : same / total, matched };
}

// Jaccard overlap: shared interests divided by all interests either person has.
export function sharedInterests(a: Member, b: Member): string[] {
  const theirs = new Set(b.interests);
  return a.interests.filter((i) => theirs.has(i));
}

export function interestsJaccard(a: Member, b: Member): number {
  const union = new Set([...a.interests, ...b.interests]).size;
  if (union === 0) return 0;
  return sharedInterests(a, b).length / union;
}

// Same pH batch scores 1, then it falls in equal steps to 0 just past the
// allowed gap (config.lifeStageMaxGap).
export function lifeStageScore(
  a: Member,
  b: Member,
  config: MatchingConfig,
): number {
  const gap = Math.abs(a.batchYear - b.batchYear);
  if (gap > config.lifeStageMaxGap) return 0;
  return 1 - gap / (config.lifeStageMaxGap + 1);
}

// Reply rate as a band. With too few chats we do not know, so use the
// neutral value instead of punishing new people.
export function responsivenessScore(
  person: Member,
  config: MatchingConfig,
): number {
  if (person.repliesDen < config.minChatsForReplyRate) {
    return config.neutralResponsiveness;
  }
  const rate = person.repliesNum / person.repliesDen;
  const band = config.replyBands.find((b) => rate >= b.atLeast);
  return band ? band.value : config.neutralResponsiveness;
}

// 1 for someone who was never shown in the recent window, down to 0 for
// someone shown config.freshnessFullAfterShown times. It nudges attention
// towards people who have had little of it.
export function freshnessScore(
  timesShown: number,
  config: MatchingConfig,
): number {
  return Math.max(0, 1 - timesShown / config.freshnessFullAfterShown);
}

export function scorePair(
  viewer: Member,
  candidate: Member,
  timesCandidateShown: number,
  config: MatchingConfig,
): ScoreBreakdown & { matchedQuestions: string[] } {
  const values = valuesSimilarity(viewer, candidate, config);
  const parts = {
    values: values.score,
    interests: interestsJaccard(viewer, candidate),
    lifeStage: lifeStageScore(viewer, candidate, config),
    intent: intentScore(viewer.intent, candidate.intent, config),
    responsiveness: responsivenessScore(candidate, config),
    freshness: freshnessScore(timesCandidateShown, config),
  };
  const w = config.weights;
  const total =
    w.values * parts.values +
    w.interests * parts.interests +
    w.lifeStage * parts.lifeStage +
    w.intent * parts.intent +
    w.responsiveness * parts.responsiveness +
    w.freshness * parts.freshness;
  return { ...parts, total, matchedQuestions: values.matched };
}
