// The hard rules: who may be shown to whom at all. Scoring only ranks people
// who pass every rule here.

import type { MatchingConfig } from "@/config/matching";
import { weeksBetween } from "./week";
import type { DropHistory, Member, MatchUser, SkipReason } from "./types";

// Step 1: is this person in the drop at all (as a viewer or a candidate)?
// Returns why not, or null when they are fine.
export function skipReason(user: MatchUser): SkipReason | null {
  if (user.deleted) return "deleted";
  if (user.suspended) return "suspended";
  if (user.paused) return "paused";
  const complete =
    user.onboarded &&
    user.gender !== null &&
    user.city !== null &&
    user.intent !== null &&
    user.batchYear !== null &&
    user.interestedIn.length > 0;
  if (!complete) return "onboarding_incomplete";
  return null;
}

// Narrows a person who passed skipReason() to one with no empty fields.
export function toMember(user: MatchUser): Member {
  return {
    ...user,
    gender: user.gender!,
    city: user.city!,
    intent: user.intent!,
    batchYear: user.batchYear!,
  };
}

// How compatible two intents are (0 to 1). The config key is the two intents
// sorted and joined with "+".
export function intentScore(a: string, b: string, config: MatchingConfig) {
  const key = [a, b].sort().join("+");
  return config.intentScores[key] ?? 0;
}

export type PairRejection =
  | "self"
  | "different_city"
  | "gender_preference"
  | "age_gap"
  | "intent_incompatible"
  | "blocked"
  | "seen_recently";

// Everything about the past, turned into fast lookups.
export type PairLookups = {
  blocked: Set<string>; // "a>b" for both directions
  seenRecently: Set<string>; // "viewer>candidate"
  shownCount: Map<string, number>; // candidate -> times shown in the window
};

export const pairKey = (a: string, b: string) => `${a}>${b}`;

export function buildLookups(
  history: DropHistory,
  config: MatchingConfig,
): PairLookups {
  const blocked = new Set<string>();
  for (const b of history.blocks) {
    blocked.add(pairKey(b.blockerId, b.blockedId));
    blocked.add(pairKey(b.blockedId, b.blockerId));
  }

  const seenRecently = new Set<string>();
  const shownCount = new Map<string, number>();
  for (const row of history.seen) {
    // Rows from this week or later belong to the drop being (re)built, so they
    // do not count. Only the last N earlier weeks do.
    const weeksAgo = weeksBetween(row.weekStart, history.weekStart);
    if (weeksAgo < 1 || weeksAgo > config.noRepeatWeeks) continue;
    seenRecently.add(pairKey(row.viewerId, row.candidateId));
    shownCount.set(row.candidateId, (shownCount.get(row.candidateId) ?? 0) + 1);
  }
  // A live conversation counts as "seen" for ever, in both directions.
  for (const c of history.connected ?? []) {
    seenRecently.add(pairKey(c.a, c.b));
    seenRecently.add(pairKey(c.b, c.a));
  }
  return { blocked, seenRecently, shownCount };
}

// Can `candidate` be on `viewer`'s shortlist? Returns the first rule that
// says no, or null when every rule passes. The "seen" rule is checked last,
// so a "seen_recently" answer means the pair was otherwise fine.
export function rejectPair(
  viewer: Member,
  candidate: Member,
  lookups: PairLookups,
  config: MatchingConfig,
): PairRejection | null {
  if (viewer.id === candidate.id) return "self";
  if (viewer.city !== candidate.city) return "different_city";

  // Mutual: each person must be interested in the other's gender.
  if (
    !viewer.interestedIn.includes(candidate.gender) ||
    !candidate.interestedIn.includes(viewer.gender)
  ) {
    return "gender_preference";
  }

  // Mutual by symmetry: the gap is the same from both sides.
  if (Math.abs(viewer.age - candidate.age) > config.maxAgeGapYears) {
    return "age_gap";
  }

  if (intentScore(viewer.intent, candidate.intent, config) <= 0) {
    return "intent_incompatible";
  }

  if (lookups.blocked.has(pairKey(viewer.id, candidate.id))) return "blocked";

  if (lookups.seenRecently.has(pairKey(viewer.id, candidate.id))) {
    return "seen_recently";
  }
  return null;
}
