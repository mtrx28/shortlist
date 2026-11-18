import { describe, expect, it } from "vitest";
import { buildDrop } from "@/lib/matching/build-drop";
import type { IntroRow, MatchUser } from "@/lib/matching/types";
import {
  answers,
  config,
  history,
  man,
  user,
  WEEK,
  woman,
} from "./matching-fixtures";

const run = (
  users: MatchUser[],
  hist = history(),
  cfg = config(),
  seed = "seed-1",
) => buildDrop(users, hist, cfg, seed);

const pairs = (intros: IntroRow[]) =>
  intros.map((i) => `${i.viewerId}>${i.candidateId}`).sort();

const shownTo = (intros: IntroRow[], viewer: string) =>
  intros.filter((i) => i.viewerId === viewer).map((i) => i.candidateId);

const appearances = (intros: IntroRow[]) => {
  const count = new Map<string, number>();
  for (const i of intros)
    count.set(i.candidateId, (count.get(i.candidateId) ?? 0) + 1);
  return count;
};

describe("who takes part", () => {
  it("leaves out paused, deleted, suspended and unfinished profiles, and counts them", () => {
    const users = [
      woman("w"),
      man("m"),
      man("paused", { paused: true }),
      man("deleted", { deleted: true }),
      man("suspended", { suspended: true }),
      man("unfinished", { onboarded: false }),
      man("no-city", { city: null }),
    ];
    const { intros, stats } = run(users);
    expect(pairs(intros)).toEqual(["m>w", "w>m"]);
    expect(stats.usersConsidered).toBe(7);
    expect(stats.usersEligible).toBe(2);
    expect(stats.skipped).toEqual({
      paused: 1,
      deleted: 1,
      suspended: 1,
      onboarding_incomplete: 2,
    });
  });

  it("never matches someone with themselves", () => {
    const { intros } = run([user("solo", { interestedIn: ["woman", "man"] })]);
    expect(intros).toEqual([]);
  });
});

describe("hard filters", () => {
  it("needs the same city", () => {
    const { intros } = run([
      woman("w"),
      man("near"),
      man("far", { city: "Chennai" }),
    ]);
    expect(shownTo(intros, "w")).toEqual(["near"]);
  });

  it("needs gender preference to be mutual", () => {
    const users = [
      woman("w"),
      man("likes-her"),
      // He is interested in men only, so he and w never see each other.
      man("not-interested", { interestedIn: ["man"] }),
    ];
    const { intros } = run(users);
    expect(shownTo(intros, "w")).toEqual(["likes-her"]);
    expect(shownTo(intros, "not-interested")).toEqual([]);
  });

  it("works for any gender combination that both people want", () => {
    const users = [
      user("a", { gender: "woman", interestedIn: ["woman"] }),
      user("b", { gender: "woman", interestedIn: ["woman", "non_binary"] }),
      user("c", { gender: "non_binary", interestedIn: ["woman"] }),
    ];
    const { intros } = run(users);
    // a-b want each other; b-c want each other; a does not want c.
    expect(shownTo(intros, "a")).toEqual(["b"]);
    expect(shownTo(intros, "c")).toEqual(["b"]);
    expect(shownTo(intros, "b").sort()).toEqual(["a", "c"]);
  });

  it("needs ages within the allowed gap, from both sides", () => {
    const users = [
      woman("w", { age: 25 }),
      man("close", { age: 31 }),
      man("too-old", { age: 32 }),
    ];
    const { intros } = run(users, history(), config({ maxAgeGapYears: 6 }));
    expect(shownTo(intros, "w")).toEqual(["close"]);
    expect(shownTo(intros, "too-old")).toEqual([]);
    expect(shownTo(intros, "close")).toEqual(["w"]);
  });

  it("drops pairs whose intents are not compatible (config 0)", () => {
    const strict = config({
      intentScores: {
        ...config().intentScores,
        "friendships_first+serious": 0,
      },
    });
    const users = [
      woman("w", { intent: "serious" }),
      man("friend", { intent: "friendships_first" }),
      man("serious", { intent: "serious" }),
    ];
    const { intros } = run(users, history(), strict);
    expect(shownTo(intros, "w")).toEqual(["serious"]);
  });

  it("lets friendship-first people meet anyone with the default config", () => {
    const users = [
      woman("w", { intent: "friendships_first" }),
      man("s", { intent: "serious" }),
      man("o", { intent: "open_to_see" }),
    ];
    const { intros } = run(users);
    expect(shownTo(intros, "w").sort()).toEqual(["o", "s"]);
  });

  it("never shows a blocked person, whichever side blocked", () => {
    const users = [
      woman("w"),
      man("blocked-by-w"),
      man("blocked-w"),
      man("fine"),
    ];
    const { intros } = run(
      users,
      history({
        blocks: [
          { blockerId: "w", blockedId: "blocked-by-w" },
          { blockerId: "blocked-w", blockedId: "w" },
        ],
      }),
    );
    expect(shownTo(intros, "w")).toEqual(["fine"]);
    // And not the other way round either.
    expect(shownTo(intros, "blocked-by-w")).not.toContain("w");
    expect(shownTo(intros, "blocked-w")).not.toContain("w");
  });

  it("does not repeat someone shown in the last 8 weeks, but allows them after", () => {
    const users = [woman("w"), man("a"), man("b"), man("c"), man("d")];
    const seen = [
      { viewerId: "w", candidateId: "a", weekStart: "2026-11-09" }, // 1 week ago
      { viewerId: "w", candidateId: "b", weekStart: "2026-09-21" }, // 8 weeks ago
      { viewerId: "w", candidateId: "c", weekStart: "2026-09-14" }, // 9 weeks ago
    ];
    const { intros } = run(users, history({ seen }));
    expect(shownTo(intros, "w").sort()).toEqual(["c", "d"]);
  });

  it("ignores intros from the week being rebuilt, and applies to the viewer only", () => {
    const users = [woman("w"), man("a")];
    const seen = [
      { viewerId: "w", candidateId: "a", weekStart: WEEK }, // same week: ignored
      { viewerId: "a", candidateId: "w", weekStart: "2026-11-09" }, // a saw w, not w saw a
    ];
    const { intros } = run(users, history({ seen }));
    expect(shownTo(intros, "w")).toEqual(["a"]);
    expect(shownTo(intros, "a")).toEqual([]);
  });

  it("does not show people who already have a live conversation", () => {
    const { intros } = run(
      [woman("w"), man("chatting"), man("new")],
      history({ connected: [{ a: "chatting", b: "w" }] }),
    );
    expect(shownTo(intros, "w")).toEqual(["new"]);
    expect(shownTo(intros, "chatting")).toEqual([]);
  });
});

describe("how many intros", () => {
  const crowd = (plusIds: string[] = []) => [
    woman("w", { isPlus: plusIds.includes("w") }),
    ...["m1", "m2", "m3", "m4", "m5", "m6"].map((id) =>
      man(id, { isPlus: plusIds.includes(id) }),
    ),
  ];

  it("gives a free member 3 intros", () => {
    expect(shownTo(run(crowd()).intros, "w")).toHaveLength(3);
  });

  it("gives a Plus member 5 intros", () => {
    expect(shownTo(run(crowd(["w"])).intros, "w")).toHaveLength(5);
  });

  it("follows the numbers in the config", () => {
    const cfg = config({ introsFree: 2, introsPlus: 4 });
    expect(shownTo(run(crowd(), history(), cfg).intros, "w")).toHaveLength(2);
    expect(shownTo(run(crowd(["w"]), history(), cfg).intros, "w")).toHaveLength(
      4,
    );
  });

  it("returns fewer intros for a thin pool and never pads with weak matches", () => {
    // One man in the city: one intro, not three.
    expect(shownTo(run([woman("w"), man("only")]).intros, "w")).toEqual([
      "only",
    ]);

    // A man who agrees with her on nothing, shares no interests, is a very
    // different batch and has the least compatible intent is below minScore.
    const poor = man("poor", {
      values: answers(1),
      interests: ["Reading", "Gaming", "Pets"],
      batchYear: 2025,
      intent: "friendships_first",
      repliesNum: 0,
      repliesDen: 10,
    });
    const strict = config({ minScore: 0.5 });
    const { intros, stats } = run([woman("w"), poor], history(), strict);
    expect(intros).toEqual([]);
    expect(stats.zeroIntroReasons.below_min_score).toBe(2);
  });
});

describe("the shortlist cap", () => {
  // Ten women and two men in one city. Every woman wants both men, so without
  // a cap the two men would be in all ten shortlists.
  const women = Array.from({ length: 10 }, (_, i) => woman(`w${i}`));
  const men = [man("m1"), man("m2")];

  it("never puts anyone in more than 5 shortlists", () => {
    const { intros, stats } = run([...women, ...men]);
    for (const [id, n] of appearances(intros)) {
      expect(n, id).toBeLessThanOrEqual(5);
    }
    expect(stats.shortlistAppearances.max).toBe(5);
  });

  it("holds for other seeds and other caps", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      for (const cap of [1, 2, 5]) {
        const { intros } = run(
          [...women, ...men],
          history(),
          config({ maxShortlistsPerCandidate: cap }),
          seed,
        );
        for (const n of appearances(intros).values())
          expect(n).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("lets everyone have a turn before anyone gets a second pick", () => {
    const { intros } = run([...women, ...men]);
    // 10 slots exist (2 men x 5) and there are 10 women: one each.
    for (const w of women) expect(shownTo(intros, w.id)).toHaveLength(1);
  });

  it("applies the cap to Plus members' extra intros too", () => {
    const plusWomen = women.map((w) => ({ ...w, isPlus: true }));
    const { intros } = run([...plusWomen, ...men]);
    for (const n of appearances(intros).values())
      expect(n).toBeLessThanOrEqual(5);
    // The two men fill their 10 places; Plus does not buy extra room.
    expect(intros.filter((i) => i.viewerId.startsWith("w"))).toHaveLength(10);
  });

  it("says in the stats why some people got nothing", () => {
    const eleven = [...women, woman("w10"), ...men];
    const { stats } = run(eleven);
    expect(stats.usersWithZeroIntros).toBe(1);
    expect(stats.zeroIntroReasons.candidates_full).toBe(1);
  });
});

describe("repeatable results", () => {
  const users = [
    ...Array.from({ length: 10 }, (_, i) => woman(`w${i}`)),
    man("m1"),
    man("m2"),
  ];

  it("gives the same drop for the same seed", () => {
    expect(run(users, history(), config(), "x")).toEqual(
      run(users, history(), config(), "x"),
    );
  });

  it("does not depend on the order of the input list", () => {
    expect(run([...users].reverse(), history(), config(), "x")).toEqual(
      run(users, history(), config(), "x"),
    );
  });

  it("can give a different drop for a different seed", () => {
    // With 10 women and 5+5 places per man, who gets whom depends on the turn order.
    const outcomes = new Set(
      ["a", "b", "c", "d", "e", "f"].map((seed) =>
        JSON.stringify(pairs(run(users, history(), config(), seed).intros)),
      ),
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

describe("stats", () => {
  it("reports fairness numbers and the share of people with an intro", () => {
    const users = [
      woman("w1"),
      woman("w2"),
      man("m1"),
      man("m2"),
      man("alone", { city: "Chennai" }),
    ];
    const { stats } = run(users);
    expect(stats.usersEligible).toBe(5);
    expect(stats.usersWithIntros).toBe(4);
    expect(stats.shareWithAtLeastOneIntro).toBe(0.8);
    expect(stats.zeroIntroReasons.no_compatible_people).toBe(1);
    expect(stats.shortlistAppearances).toEqual({ max: 2, min: 0, mean: 1.6 });
    expect(stats.introsCreated).toBe(8);
  });

  it("tells apart 'only people I already saw' from 'nobody fits'", () => {
    const { stats } = run(
      [woman("w"), man("m")],
      history({
        seen: [{ viewerId: "w", candidateId: "m", weekStart: "2026-11-09" }],
      }),
    );
    expect(stats.zeroIntroReasons.already_seen).toBe(1);
    expect(stats.zeroIntroReasons.no_compatible_people).toBe(0);
  });

  it("handles an empty list of people", () => {
    const { intros, stats } = run([]);
    expect(intros).toEqual([]);
    expect(stats.shareWithAtLeastOneIntro).toBe(0);
    expect(stats.shortlistAppearances).toEqual({ max: 0, min: 0, mean: 0 });
  });
});
