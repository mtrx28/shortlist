import { describe, expect, it } from "vitest";
import { MATCHING_CONFIG, VALUE_TOPICS } from "@/config/matching";
import { VALUES_QUESTIONS } from "@/config/values-questions";
import { buildDrop } from "@/lib/matching/build-drop";
import { toMember } from "@/lib/matching/filters";
import { buildReasons } from "@/lib/matching/reasons";
import {
  freshnessScore,
  interestsJaccard,
  lifeStageScore,
  responsivenessScore,
  scorePair,
  valuesSimilarity,
} from "@/lib/matching/score";
import { dropWeekStart, weeksBetween } from "@/lib/matching/week";
import { answers, config, history, man, woman } from "./matching-fixtures";

const cfg = MATCHING_CONFIG;
const member = (u: ReturnType<typeof woman>) => toMember(u);

describe("config", () => {
  it("has weights that add up to 1", () => {
    const sum = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("has a topic sentence for every values question", () => {
    for (const q of VALUES_QUESTIONS)
      expect(VALUE_TOPICS[q.id], q.id).toBeTruthy();
  });

  it("uses the numbers from the plan", () => {
    expect(cfg.introsFree).toBe(3);
    expect(cfg.introsPlus).toBe(5);
    expect(cfg.maxShortlistsPerCandidate).toBe(5);
    expect(cfg.noRepeatWeeks).toBe(8);
  });
});

describe("values similarity", () => {
  const a = member(woman("a"));

  it("is the share of questions answered the same way", () => {
    const b = member(
      man("b", { values: answers(0, { weekend: 1, morning: 1 }) }),
    );
    const { score, matched } = valuesSimilarity(a, b, cfg);
    expect(score).toBeCloseTo(6 / 8, 10);
    expect(matched).not.toContain("weekend");
    expect(matched).toHaveLength(6);
  });

  it("counts a deal-breaker question double, so agreeing on it is worth more", () => {
    // Same single disagreement, once on a normal question, once on a
    // deal-breaker (flagged by the other person: either side counts).
    const normal = member(man("n", { values: answers(0, { weekend: 1 }) }));
    const flagged = member(
      man("f", { values: answers(0, { weekend: 1 }, ["weekend"]) }),
    );
    expect(valuesSimilarity(a, normal, cfg).score).toBeCloseTo(7 / 8, 10);
    // 8 questions, one counts double: total weight 9, the miss costs 2.
    expect(valuesSimilarity(a, flagged, cfg).score).toBeCloseTo(7 / 9, 10);
    expect(valuesSimilarity(a, flagged, cfg).score).toBeLessThan(
      valuesSimilarity(a, normal, cfg).score,
    );
  });

  it("also rewards agreeing on a deal-breaker", () => {
    const mine = member(
      woman("a", { values: answers(0, { kids: 1 }, ["kids"]) }),
    );
    const agree = member(man("b", { values: answers(0, { kids: 1 }) }));
    const disagree = member(man("c", { values: answers(0, { kids: 2 }) }));
    expect(valuesSimilarity(mine, agree, cfg).score).toBe(1);
    expect(valuesSimilarity(mine, disagree, cfg).score).toBeCloseTo(7 / 9, 10);
  });
});

describe("the other score parts", () => {
  it("interests: shared divided by all", () => {
    const x = member(woman("x", { interests: ["A", "B", "C"] }));
    const y = member(man("y", { interests: ["B", "C", "D", "E"] }));
    expect(interestsJaccard(x, y)).toBeCloseTo(2 / 5, 10);
    expect(interestsJaccard(x, member(man("z", { interests: [] })))).toBe(0);
  });

  it("life stage: full credit for the same batch, less for each year apart, none past the gap", () => {
    const a = member(woman("a", { batchYear: 2021 }));
    const at = (year: number) =>
      lifeStageScore(a, member(man("b", { batchYear: year })), cfg);
    expect(at(2021)).toBe(1);
    expect(at(2022)).toBeCloseTo(2 / 3, 10);
    expect(at(2023)).toBeCloseTo(1 / 3, 10);
    expect(at(2024)).toBe(0);
  });

  it("responsiveness: neutral before 5 chats, then a band", () => {
    const at = (num: number, den: number) =>
      responsivenessScore(
        member(man("m", { repliesNum: num, repliesDen: den })),
        cfg,
      );
    expect(at(0, 4)).toBe(cfg.neutralResponsiveness);
    expect(at(5, 5)).toBe(1);
    expect(at(2, 5)).toBe(0.6);
    expect(at(1, 10)).toBe(0.2);
  });

  it("freshness: 1 if never shown, 0 once shown 10 times", () => {
    expect(freshnessScore(0, cfg)).toBe(1);
    expect(freshnessScore(5, cfg)).toBe(0.5);
    expect(freshnessScore(10, cfg)).toBe(0);
    expect(freshnessScore(40, cfg)).toBe(0);
  });

  it("gives a perfect pair a score between 0 and 1", () => {
    const { total } = scorePair(member(woman("a")), member(man("b")), 0, cfg);
    // Everything matches; only responsiveness is neutral (0.5 x 0.10).
    expect(total).toBeCloseTo(0.95, 10);
    expect(total).toBeLessThanOrEqual(1);
  });
});

describe("reasons", () => {
  const run = (
    viewer: ReturnType<typeof woman>,
    candidate: ReturnType<typeof man>,
    extra = {},
  ) => {
    const { intros } = buildDrop(
      [viewer, candidate],
      history(),
      config(extra),
      "s",
    );
    return intros.find((i) => i.viewerId === viewer.id)!.reasons;
  };

  it("writes two reasons from the strongest signals", () => {
    const reasons = run(woman("w"), man("m"));
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(/^You answered alike on /);
    expect(reasons[1]).toMatch(/^You both enjoy /);
  });

  it("names topics, never the answers", () => {
    const reasons = run(woman("w"), man("m")).join(" ");
    for (const q of VALUES_QUESTIONS) {
      for (const o of q.options) expect(reasons).not.toContain(o.label);
    }
  });

  it("puts the viewer's own deal-breaker topic first, and ignores the other person's flags", () => {
    const viewer = woman("w", { values: answers(0, {}, ["kids", "money"]) });
    const candidate = man("m", {
      values: answers(0, {}, ["weekend", "social"]),
    });
    const reasons = run(viewer, candidate);
    expect(reasons[0]).toContain(VALUE_TOPICS.kids);
    expect(reasons[0]).toContain(VALUE_TOPICS.money);
    expect(reasons[0]).not.toContain(VALUE_TOPICS.weekend);
  });

  it("uses at most two shared interests and never mentions age or birth dates", () => {
    const reasons = run(
      woman("w", { age: 27, interests: ["Yoga", "Coffee", "Movies", "Gym"] }),
      man("m", { age: 27, interests: ["Yoga", "Coffee", "Movies", "Gym"] }),
    ).join(" ");
    expect(reasons).toContain("Yoga and Coffee");
    expect(reasons).not.toContain("Movies");
    expect(reasons).not.toMatch(/\b27\b|born|birth|dob/i);
  });

  it("falls back to the city when nothing else can be said", () => {
    const viewer = woman("w", {
      values: answers(0),
      interests: ["Yoga"],
      batchYear: 2020,
      intent: "open_to_see",
    });
    const candidate = man("m", {
      values: answers(1), // agrees on nothing
      interests: ["Gaming"],
      batchYear: 2023, // too far for life-stage credit
      intent: "serious",
    });
    const reasons = run(viewer, candidate, { minScore: 0 });
    expect(reasons).toEqual(["You are both in Pune"]);
  });

  it("mentions replies only for the top reply band, not for 'unknown'", () => {
    const quiet = run(
      woman("w"),
      man("m", { repliesNum: 0, repliesDen: 2 }),
    ).join(" ");
    expect(quiet).not.toContain("reply");
    const viewer = member(woman("w"));
    const candidate = member(man("m", { repliesNum: 9, repliesDen: 10 }));
    const breakdown = scorePair(viewer, candidate, 0, cfg);
    // Ask for every reason to see whether the responsiveness one exists.
    const all = buildReasons(viewer, candidate, breakdown, {
      ...cfg,
      reasonsPerIntro: 5,
    });
    expect(all.some((r) => r.includes("usually reply"))).toBe(true);
  });
});

describe("weeks", () => {
  it("counts a Sunday run as next week's drop", () => {
    expect(dropWeekStart(new Date("2026-11-15T14:30:00Z"))).toBe("2026-11-16"); // Sunday
    expect(dropWeekStart(new Date("2026-11-16T09:00:00Z"))).toBe("2026-11-16"); // Monday
    expect(dropWeekStart(new Date("2026-11-21T23:00:00Z"))).toBe("2026-11-16"); // Saturday
  });

  it("counts whole weeks between two Mondays", () => {
    expect(weeksBetween("2026-09-21", "2026-11-16")).toBe(8);
    expect(weeksBetween("2026-11-16", "2026-11-16")).toBe(0);
  });
});
