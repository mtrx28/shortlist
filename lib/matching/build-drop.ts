// The weekly drop: decides who is shown to whom.
//
//   buildDrop(users, history, config, seed) -> { intros, stats }
//
// It is a pure function: no database, no clock, no global random numbers.
// The same input and seed always give the same output, so it can be unit
// tested and a re-run gives the same drop.
//
// Steps
//   1. Drop people who cannot take part (paused, deleted, suspended, profile
//      not finished).
//   2. For each person, list the candidates who pass every hard rule
//      (lib/matching/filters.ts) and score them (lib/matching/score.ts).
//      Anyone scoring under config.minScore is dropped: fewer intros are
//      better than weak ones.
//   3. Assign. People take turns in a seeded random order; on each turn a
//      person takes their best candidate who is not yet in
//      config.maxShortlistsPerCandidate shortlists. Turns repeat until
//      everyone has their quota (3 free, 5 Plus) or has run out of options.
//   4. Write two plain reasons for each intro.
//
// Why greedy, and what it costs. Giving every person the best set of
// candidates while no candidate is over capacity is a "b-matching" problem; the
// optimal answer can be found with a min-cost flow algorithm. Greedy is NOT
// optimal: an early pick can use up a slot that someone with fewer options
// needed. I chose it because (a) it is easy to explain line by line,
// (b) with a cap of 5 and 3 slots per person, capacity is rarely the limit, so
// the loss is small, (c) the turn-taking (one pick per round instead of a
// whole shortlist at once) stops whoever is first in the random order from
// taking all the good candidates, and (d) the seeded order is shuffled afresh
// each week, so nobody is always first. If measurements ever show that many
// people are left with nothing because of capacity, swap this step for a flow
// solver; nothing else needs to change.

import type { MatchingConfig } from "@/config/matching";
import { buildLookups, rejectPair, skipReason, toMember } from "./filters";
import { makeRng, shuffle } from "./random";
import { buildReasons } from "./reasons";
import { scorePair } from "./score";
import type {
  DropHistory,
  DropResult,
  DropStats,
  IntroRow,
  MatchUser,
  Member,
  ScoreBreakdown,
  SkipReason,
  ZeroIntroReason,
} from "./types";

type Ranked = {
  candidate: Member;
  breakdown: ScoreBreakdown & { matchedQuestions: string[] };
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function buildDrop(
  users: MatchUser[],
  history: DropHistory,
  config: MatchingConfig,
  seed: string,
): DropResult {
  // 1. Who takes part. Sorting by id first means the order of the input list
  // never changes the result.
  const skipped: Record<SkipReason, number> = {
    paused: 0,
    deleted: 0,
    suspended: 0,
    onboarding_incomplete: 0,
  };
  const members: Member[] = [];
  for (const user of [...users].sort((a, b) => a.id.localeCompare(b.id))) {
    const reason = skipReason(user);
    if (reason) skipped[reason] += 1;
    else members.push(toMember(user));
  }

  const lookups = buildLookups(history, config);
  const byCity = new Map<string, Member[]>();
  for (const m of members) {
    byCity.set(m.city, [...(byCity.get(m.city) ?? []), m]);
  }

  // 2. Candidate lists. Only people in the same city are compared, which
  // keeps the work small (each city is compared with itself, not everyone
  // with everyone).
  const ranked = new Map<string, Ranked[]>();
  const sawRecentlySeen = new Set<string>(); // viewers who lost someone to the no-repeat rule
  const hadPool = new Set<string>(); // viewers with at least one candidate after the filters
  const rng = makeRng(seed);
  const order = shuffle(members, rng); // the turn order, also the tie-break
  const turnOf = new Map(order.map((m, i) => [m.id, i]));

  for (const viewer of members) {
    const list: Ranked[] = [];
    for (const candidate of byCity.get(viewer.city) ?? []) {
      const rejection = rejectPair(viewer, candidate, lookups, config);
      if (rejection === "seen_recently") sawRecentlySeen.add(viewer.id);
      if (rejection) continue;
      hadPool.add(viewer.id);
      const breakdown = scorePair(
        viewer,
        candidate,
        lookups.shownCount.get(candidate.id) ?? 0,
        config,
      );
      if (breakdown.total >= config.minScore)
        list.push({ candidate, breakdown });
    }
    // Best score first; equal scores are split by the random turn order.
    list.sort(
      (a, b) =>
        b.breakdown.total - a.breakdown.total ||
        (turnOf.get(a.candidate.id) ?? 0) - (turnOf.get(b.candidate.id) ?? 0),
    );
    ranked.set(viewer.id, list);
  }

  // 3. Turn-taking assignment under the capacity cap.
  const quota = (m: Member) =>
    m.isPlus ? config.introsPlus : config.introsFree;
  const maxQuota = Math.max(0, ...members.map(quota));
  const picks = new Map<string, Ranked[]>(members.map((m) => [m.id, []]));
  const next = new Map<string, number>(members.map((m) => [m.id, 0])); // place in each person's list
  const appearances = new Map<string, number>(members.map((m) => [m.id, 0]));

  for (let round = 0; round < maxQuota; round++) {
    for (const viewer of order) {
      const mine = picks.get(viewer.id)!;
      if (mine.length >= quota(viewer)) continue;
      const list = ranked.get(viewer.id)!;
      let i = next.get(viewer.id)!;
      // A candidate who is full now stays full (counts only go up), so it is
      // safe to move past them for good.
      while (
        i < list.length &&
        (appearances.get(list[i].candidate.id) ?? 0) >=
          config.maxShortlistsPerCandidate
      ) {
        i++;
      }
      if (i < list.length) {
        mine.push(list[i]);
        const id = list[i].candidate.id;
        appearances.set(id, (appearances.get(id) ?? 0) + 1);
        i++;
      }
      next.set(viewer.id, i);
    }
  }

  // 4. Output rows with reasons, and the stats.
  const intros: IntroRow[] = [];
  for (const viewer of order) {
    for (const pick of picks.get(viewer.id)!) {
      intros.push({
        viewerId: viewer.id,
        candidateId: pick.candidate.id,
        score: round4(pick.breakdown.total),
        reasons: buildReasons(viewer, pick.candidate, pick.breakdown, config),
      });
    }
  }

  const zeroIntroReasons: Record<ZeroIntroReason, number> = {
    no_compatible_people: 0,
    already_seen: 0,
    below_min_score: 0,
    candidates_full: 0,
  };
  let usersWithIntros = 0;
  for (const m of members) {
    if (picks.get(m.id)!.length > 0) {
      usersWithIntros++;
    } else if (!hadPool.has(m.id)) {
      zeroIntroReasons[
        sawRecentlySeen.has(m.id) ? "already_seen" : "no_compatible_people"
      ]++;
    } else if (ranked.get(m.id)!.length === 0) {
      zeroIntroReasons.below_min_score++;
    } else {
      zeroIntroReasons.candidates_full++;
    }
  }

  const counts = members.map((m) => appearances.get(m.id) ?? 0);
  const stats: DropStats = {
    seed,
    weekStart: history.weekStart,
    usersConsidered: users.length,
    usersEligible: members.length,
    skipped,
    introsCreated: intros.length,
    usersWithIntros,
    usersWithZeroIntros: members.length - usersWithIntros,
    shareWithAtLeastOneIntro:
      members.length === 0 ? 0 : round4(usersWithIntros / members.length),
    zeroIntroReasons,
    shortlistAppearances: {
      max: counts.length ? Math.max(...counts) : 0,
      min: counts.length ? Math.min(...counts) : 0,
      mean: counts.length
        ? round4(counts.reduce((a, b) => a + b, 0) / counts.length)
        : 0,
    },
  };

  return { intros, stats };
}
