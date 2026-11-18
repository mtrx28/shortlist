import { describe, expect, it } from "vitest";
import { MATCHING_CONFIG } from "@/config/matching";
import { ageOn, parseIsoDate } from "@/lib/age";
import { buildDrop } from "@/lib/matching/build-drop";
import type { MatchUser } from "@/lib/matching/types";
import { dropWeekStart } from "@/lib/matching/week";
import {
  buildDemoProfiles,
  buildScenario,
  type DemoProfile,
} from "@/scripts/seed/demo-data";

// The drop run on the same invented people the seed script creates.

const NOW = new Date("2026-11-19T10:00:00Z");
const profiles = buildDemoProfiles();

const toUser = (p: DemoProfile): MatchUser => ({
  id: p.handle,
  gender: p.gender,
  interestedIn: p.interestedIn,
  age: ageOn(parseIsoDate(p.dob)!, NOW),
  city: p.city,
  intent: p.intent,
  batchYear: p.batchYear,
  interests: p.interests,
  values: p.valuesAnswers,
  paused: p.paused,
  deleted: false,
  suspended: false,
  onboarded: true,
  isPlus: false,
  repliesNum: 0,
  repliesDen: 0,
});

const users = profiles.map(toUser);
const weekStart = dropWeekStart(NOW);
const drop = (hist: Parameters<typeof buildDrop>[1]) =>
  buildDrop(users, hist, MATCHING_CONFIG, `drop:${weekStart}`);

describe("the drop on the seed's demo members", () => {
  it("gives every member except the paused admin at least one intro (fresh start)", () => {
    const { intros, stats } = drop({ weekStart, seen: [], blocks: [] });
    const withIntro = new Set(intros.map((i) => i.viewerId));
    for (const p of profiles.filter((p) => p.role !== "admin")) {
      expect(withIntro.has(p.handle), p.handle).toBe(true);
    }
    expect(withIntro.has("admin")).toBe(false);
    expect(stats.skipped.paused).toBe(1);
    expect(stats.usersWithZeroIntros).toBe(0);
    expect(stats.shareWithAtLeastOneIntro).toBe(1);
  });

  it("stays inside each city and respects the cap and the quota", () => {
    const { intros, stats } = drop({ weekStart, seen: [], blocks: [] });
    const city = new Map(profiles.map((p) => [p.handle, p.city]));
    const perViewer = new Map<string, number>();
    const perCandidate = new Map<string, number>();
    for (const i of intros) {
      expect(city.get(i.viewerId)).toBe(city.get(i.candidateId));
      perViewer.set(i.viewerId, (perViewer.get(i.viewerId) ?? 0) + 1);
      perCandidate.set(
        i.candidateId,
        (perCandidate.get(i.candidateId) ?? 0) + 1,
      );
    }
    for (const n of perViewer.values()) expect(n).toBeLessThanOrEqual(3);
    for (const n of perCandidate.values()) expect(n).toBeLessThanOrEqual(5);
    expect(stats.shortlistAppearances.max).toBeLessThanOrEqual(5);
  });

  it("gives every intro two reasons and a score between the minimum and 1", () => {
    const { intros } = drop({ weekStart, seen: [], blocks: [] });
    expect(intros.length).toBeGreaterThan(20);
    for (const i of intros) {
      expect(i.reasons).toHaveLength(2);
      expect(i.score).toBeGreaterThanOrEqual(MATCHING_CONFIG.minScore);
      expect(i.score).toBeLessThanOrEqual(1);
    }
  });

  it("with last week's seeded intros as history, shows nobody a repeat", () => {
    const scenario = buildScenario(
      profiles,
      Object.fromEntries(profiles.map((p) => [p.handle, p.handle])),
      NOW,
    );
    const lastWeek = scenario.drops[0];
    const seen = scenario.intros
      .filter((i) => i.drop_id === lastWeek.id)
      .map((i) => ({
        viewerId: i.viewer_id,
        candidateId: i.candidate_id,
        weekStart: lastWeek.week_start,
      }));
    const { intros, stats } = drop({ weekStart, seen, blocks: [] });
    const repeats = new Set(seen.map((s) => `${s.viewerId}>${s.candidateId}`));
    for (const i of intros) {
      expect(repeats.has(`${i.viewerId}>${i.candidateId}`)).toBe(false);
    }
    // Thin pools are honest: anyone with nobody left is counted, not padded.
    // (In Gurugram, Rahul's only possible match was shown to him last week.)
    const withIntro = new Set(intros.map((i) => i.viewerId));
    const without = profiles
      .filter((p) => p.role !== "admin" && !withIntro.has(p.handle))
      .map((p) => p.handle);
    expect(without).toEqual(["rahul"]);
    expect(stats.zeroIntroReasons.already_seen).toBe(1);
  });
});
