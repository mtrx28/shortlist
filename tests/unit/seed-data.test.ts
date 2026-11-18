import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MIN_AGE, ageOn, parseIsoDate } from "@/lib/age";
import { phIdSchema } from "@/lib/elitmus";
import {
  isStepComplete,
  STEPS,
  type OnboardingProfile,
} from "@/lib/onboarding";
import { CITIES, INTERESTS } from "@/config/profile-options";
import { PROMPT_ANSWER_MAX, PROMPT_ANSWER_MIN } from "@/config/prompts";
import {
  DEAL_BREAKER_COUNT,
  VALUES_QUESTIONS,
} from "@/config/values-questions";
import { AVATAR_SIZE, crc32, makeAvatarPng } from "@/scripts/seed/avatar";
import {
  PUBLISHED_LOGINS,
  buildDemoProfiles,
  buildScenario,
  uuidFromKey,
  weekStart,
  type DemoProfile,
} from "@/scripts/seed/demo-data";
import { isDemoEmail } from "@/scripts/seed/guard";

const NOW = new Date("2026-11-19T10:00:00Z"); // a Thursday
const profiles = buildDemoProfiles();

// Same shape the app uses to decide whether onboarding is complete.
function asOnboardingProfile(p: DemoProfile): OnboardingProfile {
  return {
    gender: p.gender,
    interested_in: p.interestedIn,
    city: p.city,
    intent: p.intent,
    batch_year: p.batchYear,
    occupation: p.occupation,
    values_answers: p.valuesAnswers,
    bio_prompts: p.bioPrompts,
    interests: p.interests,
    photos: ["x/1.png", "x/2.png"],
    onboarding_completed_at: null,
  };
}

describe("demo profiles", () => {
  it("creates between 14 and 20 users with unique handles and demo emails", () => {
    expect(profiles.length).toBeGreaterThanOrEqual(14);
    expect(profiles.length).toBeLessThanOrEqual(20);
    expect(new Set(profiles.map((p) => p.handle)).size).toBe(profiles.length);
    expect(profiles.every((p) => isDemoEmail(p.email))).toBe(true);
  });

  it("makes every user 18 or older", () => {
    for (const p of profiles) {
      const parts = parseIsoDate(p.dob);
      expect(parts, p.handle).not.toBeNull();
      expect(ageOn(parts!, NOW), p.handle).toBeGreaterThanOrEqual(MIN_AGE);
    }
  });

  it("satisfies every onboarding completeness rule", () => {
    for (const p of profiles) {
      const profile = asOnboardingProfile(p);
      for (const step of STEPS) {
        expect(isStepComplete(step, profile), `${p.handle} ${step}`).toBe(true);
      }
      // The database function wants 8 answers, 3 prompts, 3 interests.
      expect(Object.keys(p.valuesAnswers)).toHaveLength(
        VALUES_QUESTIONS.length,
      );
      expect(p.bioPrompts).toHaveLength(3);
      expect(new Set(p.bioPrompts.map((b) => b.id)).size).toBe(3);
      expect(p.interests.length).toBeGreaterThanOrEqual(3);
      expect(new Set(p.interests).size).toBe(p.interests.length);
      const dealBreakers = Object.values(p.valuesAnswers).filter(
        (a) => a.dealBreaker,
      );
      expect(dealBreakers).toHaveLength(DEAL_BREAKER_COUNT);
    }
  });

  it("only uses values the app accepts", () => {
    const interestList = INTERESTS as readonly string[];
    for (const p of profiles) {
      expect(CITIES as readonly string[]).toContain(p.city);
      expect([2020, 2021, 2022, 2023]).toContain(p.batchYear);
      expect(p.interests.every((i) => interestList.includes(i))).toBe(true);
      for (const q of VALUES_QUESTIONS) {
        expect(q.options.map((o) => o.id)).toContain(
          p.valuesAnswers[q.id].answer,
        );
      }
      for (const b of p.bioPrompts) {
        expect(b.answer.length).toBeGreaterThanOrEqual(PROMPT_ANSWER_MIN);
        expect(b.answer.length).toBeLessThanOrEqual(PROMPT_ANSWER_MAX);
      }
      if (p.phId) expect(phIdSchema.safeParse(p.phId).success).toBe(true);
    }
  });

  it("covers four cities, both genders, all intents and every verification state", () => {
    expect(new Set(profiles.map((p) => p.city))).toEqual(
      new Set(["Bengaluru", "Pune", "Hyderabad", "Gurugram / Noida"]),
    );
    const women = profiles.filter((p) => p.gender === "woman").length;
    const men = profiles.filter((p) => p.gender === "man").length;
    expect(Math.abs(women - men)).toBeLessThanOrEqual(2);
    expect(new Set(profiles.map((p) => p.intent)).size).toBe(3);
    expect(new Set(profiles.map((p) => p.elitmusStatus))).toEqual(
      new Set(["none", "pending", "verified"]),
    );
    // A pending or verified user always has a pH ID hash to store.
    for (const p of profiles) {
      expect(p.phId === null).toBe(p.elitmusStatus === "none");
    }
  });

  it("has exactly one admin, kept out of matching, and the published logins exist", () => {
    const admins = profiles.filter((p) => p.role === "admin");
    expect(admins.map((a) => a.handle)).toEqual(["admin"]);
    expect(admins[0].paused).toBe(true);
    for (const login of PUBLISHED_LOGINS) {
      expect(profiles.some((p) => p.handle === login.handle)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(buildDemoProfiles()).toEqual(buildDemoProfiles());
  });
});

describe("demo scenario rows", () => {
  const idOf = Object.fromEntries(
    profiles.map((p) => [p.handle, uuidFromKey(`user:${p.handle}`)]),
  );
  const scenario = buildScenario(profiles, idOf, NOW);
  const handleOf = Object.fromEntries(
    Object.entries(idOf).map(([h, id]) => [id, h]),
  );
  const profileOf = (id: string) =>
    profiles.find((p) => p.handle === handleOf[id])!;

  it("is deterministic for the same clock and moves with time", () => {
    expect(buildScenario(profiles, idOf, NOW)).toEqual(scenario);
    const later = buildScenario(
      profiles,
      idOf,
      new Date(NOW.getTime() + 3600_000),
    );
    expect(later.conversations[0].opened_at).not.toBe(
      scenario.conversations[0].opened_at,
    );
  });

  it("uses Monday dates for the two drops", () => {
    expect(weekStart(NOW)).toBe("2026-11-16");
    expect(weekStart(NOW, 1)).toBe("2026-11-09");
    expect(scenario.drops.map((d) => d.week_start)).toEqual([
      "2026-11-09",
      "2026-11-16",
    ]);
    expect(scenario.drops.every((d) => d.stats.demo === true)).toBe(true);
  });

  it("only introduces people in the same city who fit each other's preferences", () => {
    const seen = new Set<string>();
    for (const intro of scenario.intros) {
      const viewer = profileOf(intro.viewer_id);
      const candidate = profileOf(intro.candidate_id);
      expect(viewer.handle).not.toBe(candidate.handle);
      expect(viewer.city).toBe(candidate.city);
      expect(viewer.interestedIn).toContain(candidate.gender);
      expect(candidate.interestedIn).toContain(viewer.gender);
      expect(intro.reasons.length).toBeGreaterThan(0);
      expect(intro.reasons.length).toBeLessThanOrEqual(2);
      if (intro.note) expect(intro.note.length).toBeLessThanOrEqual(140);
      // Unique per drop, as the table requires.
      const key = `${intro.drop_id}:${intro.viewer_id}:${intro.candidate_id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("gives Priya a full shortlist and shows that Meera already likes Arjun", () => {
    const thisDrop = scenario.drops[1].id;
    const priya = scenario.intros.filter(
      (i) => i.viewer_id === idOf.priya && i.drop_id === thisDrop,
    );
    expect(priya).toHaveLength(3);
    expect(priya.every((i) => i.status === "new")).toBe(true);

    const meera = scenario.intros.find(
      (i) => i.viewer_id === idOf.meera && i.candidate_id === idOf.arjun,
    );
    const arjun = scenario.intros.find(
      (i) => i.viewer_id === idOf.arjun && i.candidate_id === idOf.meera,
    );
    expect(meera?.status).toBe("interested");
    expect(arjun?.status).toBe("new");
  });

  it("gives Neha a fresh, empty state", () => {
    const neha = idOf.neha;
    expect(
      scenario.intros.some(
        (i) => i.viewer_id === neha || i.candidate_id === neha,
      ),
    ).toBe(false);
    expect(
      scenario.conversations.some(
        (c) => c.user_a === neha || c.user_b === neha,
      ),
    ).toBe(false);
  });

  it("builds conversations that match the table rules", () => {
    const introIds = new Set(scenario.intros.map((i) => i.id));
    const live = new Set<string>();
    for (const c of scenario.conversations) {
      expect(c.user_a).not.toBe(c.user_b);
      expect([c.user_a, c.user_b]).toContain(c.opener_id);
      expect(introIds.has(c.origin_intro_a!)).toBe(true);
      expect(introIds.has(c.origin_intro_b!)).toBe(true);
      // The window is 72 hours.
      expect(
        new Date(c.window_ends_at).getTime() - new Date(c.opened_at).getTime(),
      ).toBe(72 * 3600_000);
      if (c.status === "open" || c.status === "kept") {
        // One live conversation per pair.
        const pair = [c.user_a, c.user_b].sort().join(":");
        expect(live.has(pair)).toBe(false);
        live.add(pair);
      }
      if (c.status === "open") {
        expect(new Date(c.window_ends_at).getTime()).toBeGreaterThan(
          NOW.getTime(),
        );
      } else {
        expect(c.status === "kept" || c.closed_reason).toBeTruthy();
      }
    }
  });

  it("has a chat close to its window end and one with plenty of time", () => {
    const hoursLeft = (a: string, b: string) => {
      const c = scenario.conversations.find(
        (x) =>
          [x.user_a, x.user_b].includes(idOf[a]) &&
          [x.user_a, x.user_b].includes(idOf[b]),
      )!;
      return (new Date(c.window_ends_at).getTime() - NOW.getTime()) / 3600_000;
    };
    expect(hoursLeft("sneha", "arjun")).toBeGreaterThan(0);
    expect(hoursLeft("sneha", "arjun")).toBeLessThan(6);
    expect(hoursLeft("priya", "rohan")).toBeGreaterThan(24);
  });

  it("covers open, kept, closed and expired conversations", () => {
    expect(new Set(scenario.conversations.map((c) => c.status))).toEqual(
      new Set(["open", "kept", "closed", "expired"]),
    );
  });

  it("only has messages from participants, inside the conversation's lifetime", () => {
    for (const m of scenario.messages) {
      const c = scenario.conversations.find((x) => x.id === m.conversation_id)!;
      expect([c.user_a, c.user_b]).toContain(m.sender_id);
      const t = new Date(m.created_at).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date(c.opened_at).getTime());
      expect(t).toBeLessThanOrEqual(NOW.getTime());
      expect(m.body.length).toBeGreaterThan(0);
      expect(m.body.length).toBeLessThanOrEqual(2000);
    }
  });

  it("has one open report and event names under the 60 character limit", () => {
    expect(scenario.reports).toHaveLength(1);
    expect(scenario.reports[0].status).toBe("open");
    expect(scenario.events.every((e) => e.name.length <= 60)).toBe(true);
  });
});

describe("avatar images", () => {
  it("makes a valid PNG of the expected size", () => {
    const png = makeAvatarPng("priya:0");
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // Walk the chunks, checking each checksum.
    let pos = 8;
    const types: string[] = [];
    const idat: Buffer[] = [];
    while (pos < png.length) {
      const length = png.readUInt32BE(pos);
      const type = png.subarray(pos + 4, pos + 8).toString("ascii");
      const data = png.subarray(pos + 8, pos + 8 + length);
      const crc = png.readUInt32BE(pos + 8 + length);
      expect(crc32(png.subarray(pos + 4, pos + 8 + length))).toBe(crc);
      types.push(type);
      if (type === "IHDR") {
        expect(data.readUInt32BE(0)).toBe(AVATAR_SIZE);
        expect(data.readUInt32BE(4)).toBe(AVATAR_SIZE);
      }
      if (type === "IDAT") idat.push(data);
      pos += 12 + length;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
    const raw = inflateSync(Buffer.concat(idat));
    expect(raw.length).toBe(AVATAR_SIZE * (AVATAR_SIZE * 3 + 1));
  });

  it("is deterministic per seed and differs between seeds", () => {
    expect(makeAvatarPng("a").equals(makeAvatarPng("a"))).toBe(true);
    expect(makeAvatarPng("a").equals(makeAvatarPng("b"))).toBe(false);
  });

  it("stays well under the 5 MB bucket limit", () => {
    expect(makeAvatarPng("priya:0").length).toBeLessThan(200_000);
  });
});
