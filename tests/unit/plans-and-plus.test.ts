import { describe, expect, it } from "vitest";
import { MATCHING_CONFIG } from "@/config/matching";
import {
  FREE_LIMITS,
  NEVER_PAYWALLED,
  PAYMENT_LIMITS,
  PLANS,
  PLAN_IDS,
  PLUS_PERKS,
  SECOND_LOOK,
  formatRupees,
  isPlanId,
} from "@/config/plans";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import { chatCap } from "@/lib/shortlist/caps";
import { entitlements, isPlus, plusEndAfterPurchase } from "@/lib/plus";

describe("plan configuration", () => {
  it("has the two plans from the decision log, in paise and days", () => {
    expect(PLAN_IDS).toEqual(["plus_1m", "plus_3m"]);
    expect(PLANS.plus_1m).toMatchObject({ amountPaise: 19900, days: 30 });
    expect(PLANS.plus_3m).toMatchObject({ amountPaise: 49900, days: 90 });
  });

  it("uses whole paise, positive days, and three months cost less per month", () => {
    for (const id of PLAN_IDS) {
      expect(Number.isInteger(PLANS[id].amountPaise)).toBe(true);
      expect(PLANS[id].amountPaise).toBeGreaterThan(0);
      expect(PLANS[id].days).toBeGreaterThan(0);
      expect(PLANS[id].id).toBe(id);
    }
    const perDay = (id: "plus_1m" | "plus_3m") =>
      PLANS[id].amountPaise / PLANS[id].days;
    expect(perDay("plus_3m")).toBeLessThan(perDay("plus_1m"));
  });

  it("only accepts known plan ids (the browser sends a plan name, never a price)", () => {
    expect(isPlanId("plus_1m")).toBe(true);
    expect(isPlanId("plus_3m")).toBe(true);
    for (const bad of [
      "plus_12m",
      "",
      "__proto__",
      "constructor",
      5,
      null,
      undefined,
    ]) {
      expect(isPlanId(bad)).toBe(false);
    }
  });

  it("formats rupees", () => {
    expect(formatRupees(19900)).toBe("Rs 199");
    expect(formatRupees(49900)).toBe("Rs 499");
    expect(formatRupees(19950)).toBe("Rs 199.50");
  });

  it("keeps the order limit small", () => {
    expect(PAYMENT_LIMITS.ordersPerHour).toBeGreaterThan(0);
    expect(PAYMENT_LIMITS.ordersPerHour).toBeLessThanOrEqual(10);
  });
});

describe("what Plus changes", () => {
  it("points at the settings the rest of the app uses, so nothing can drift", () => {
    expect(PLUS_PERKS.chatCap).toBe(SHORTLIST_CONFIG.chatCapPlus);
    expect(PLUS_PERKS.introsPerDrop).toBe(MATCHING_CONFIG.introsPlus);
    expect(FREE_LIMITS.chatCap).toBe(SHORTLIST_CONFIG.chatCapFree);
    expect(FREE_LIMITS.introsPerDrop).toBe(MATCHING_CONFIG.introsFree);
  });

  it("is a modest step: 3 to 5 chats, 3 to 5 intros, one second look a month", () => {
    expect(FREE_LIMITS).toEqual({ chatCap: 3, introsPerDrop: 3 });
    expect(PLUS_PERKS).toMatchObject({
      chatCap: 5,
      introsPerDrop: 5,
      secondLookPerMonth: 1,
    });
    expect(SECOND_LOOK.perDays).toBe(30);
  });

  it("never lists a protected thing as a Plus perk", () => {
    const perkNames = Object.keys(PLUS_PERKS);
    const protectedKeys = NEVER_PAYWALLED.map((n) => n.key);
    expect(perkNames.filter((k) => protectedKeys.includes(k as never))).toEqual(
      [],
    );
    // The free tier keeps the full core: three intros and three chats.
    expect(FREE_LIMITS.introsPerDrop).toBeGreaterThanOrEqual(3);
  });
});

describe("isPlus and entitlements", () => {
  const now = new Date("2026-11-18T10:00:00Z");

  it("is on only while plus_until is in the future", () => {
    expect(isPlus(null, now)).toBe(false);
    expect(isPlus(undefined, now)).toBe(false);
    expect(isPlus("2026-11-18T10:00:01Z", now)).toBe(true);
    expect(isPlus("2026-11-18T10:00:00Z", now)).toBe(false); // exactly now is over
    expect(isPlus(new Date("2026-12-01"), now)).toBe(true);
    expect(isPlus("not a date", now)).toBe(false);
  });

  it("gives Plus members the bigger limits and the extras", () => {
    expect(entitlements("2027-01-01T00:00:00Z", now)).toEqual({
      isPlus: true,
      chatCap: 5,
      introsPerDrop: 5,
      reasonsDetail: true,
      secondLook: true,
    });
  });

  it("gives everyone else the free limits, with no extras", () => {
    for (const until of [null, "2026-01-01T00:00:00Z"]) {
      expect(entitlements(until, now)).toEqual({
        isPlus: false,
        chatCap: 3,
        introsPerDrop: 3,
        reasonsDetail: false,
        secondLook: false,
      });
    }
  });

  it("the chat cap used by the shortlist code is the same answer", () => {
    for (const until of [
      null,
      "2026-01-01T00:00:00Z",
      "2027-01-01T00:00:00Z",
    ]) {
      expect(chatCap(until, now)).toBe(entitlements(until, now).chatCap);
    }
  });

  it("when Plus lapses, the cap falls back to 3 (existing chats are not touched here)", () => {
    const until = "2026-11-18T12:00:00Z";
    expect(chatCap(until, new Date("2026-11-18T11:59:59Z"))).toBe(5);
    expect(chatCap(until, new Date("2026-11-18T12:00:00Z"))).toBe(3);
  });
});

describe("plusEndAfterPurchase", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const day = 24 * 3600 * 1000;

  it("starts from now for a new or lapsed member", () => {
    expect(plusEndAfterPurchase(null, 30, now).getTime()).toBe(
      now.getTime() + 30 * day,
    );
    expect(
      plusEndAfterPurchase("2026-11-01T00:00:00Z", 30, now).getTime(),
    ).toBe(now.getTime() + 30 * day);
  });

  it("adds to the end of Plus that is still running", () => {
    const until = new Date(now.getTime() + 10 * day);
    expect(plusEndAfterPurchase(until.toISOString(), 90, now).getTime()).toBe(
      until.getTime() + 90 * day,
    );
  });
});
