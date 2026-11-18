import { describe, expect, it } from "vitest";
import { MATCHING_CONFIG } from "@/config/matching";
import {
  maskId,
  summarizeOrders,
  type OrderRow,
} from "@/lib/admin/orders-stats";
import { BAND_LIMITS, bandFor, buildMatchDetail } from "@/lib/matching/detail";
import { toMember } from "@/lib/matching/filters";
import { answers, user } from "./matching-fixtures";

const row = (over: Partial<OrderRow>): OrderRow => ({
  id: "o",
  user_id: "u1",
  razorpay_order_id: "order_x",
  razorpay_payment_id: null,
  plan: "plus_1m",
  amount_paise: 19900,
  status: "created",
  provider: "simulated",
  created_at: "2026-11-18T00:00:00Z",
  paid_at: null,
  revoked_at: null,
  ...over,
});

describe("summarizeOrders", () => {
  it("counts orders, paid money and conversion (paid people / active people)", () => {
    const stats = summarizeOrders(
      [
        row({ status: "paid", user_id: "u1", amount_paise: 19900 }),
        row({ status: "paid", user_id: "u1", amount_paise: 49900 }), // same person twice
        row({
          status: "paid",
          user_id: "u2",
          amount_paise: 19900,
          revoked_at: "2026-11-19T00:00:00Z",
        }),
        row({ status: "created", user_id: "u3" }),
        row({ status: "failed", user_id: "u4" }),
      ],
      20,
    );
    expect(stats).toMatchObject({
      total: 5,
      paid: 3,
      abandoned: 1,
      failed: 1,
      revoked: 1,
      revenuePaise: 19900 + 49900 + 19900,
      paidUsers: 2,
      activeUsers: 20,
      conversionPercent: 10,
    });
  });

  it("has no conversion with no active members, and ignores deleted owners", () => {
    expect(summarizeOrders([], 0).conversionPercent).toBeNull();
    expect(
      summarizeOrders([row({ status: "paid", user_id: null })], 5).paidUsers,
    ).toBe(0);
  });
});

describe("maskId", () => {
  it("shows only the start and the end", () => {
    expect(maskId("order_Pq3xk2ab91Zc")).toBe("order_P...91Zc");
    expect(maskId(null)).toBe("-");
    expect(maskId("short")).toBe("sh...");
    expect(maskId("order_Pq3xk2ab91Zc")).not.toContain("k2ab");
  });
});

describe("buildMatchDetail (the Plus breakdown)", () => {
  const cfg = MATCHING_CONFIG;
  const a = toMember(user("a"));
  const b = toMember(
    user("b", { values: answers(0, { weekend: 1, money: 2 }) }),
  );

  it("names topics and shared interests but never an answer", () => {
    const d = buildMatchDetail(a, b, cfg);
    const text = d.lines.map((l) => l.text).join(" ");
    expect(d.lines.map((l) => l.label)).toEqual(
      expect.arrayContaining([
        "Values",
        "Interests",
        "Life stage",
        "Looking for",
        "City",
      ]),
    );
    // Topic wording, not option wording.
    expect(text).toMatch(/You answered alike on \d+ of \d+ topics/);
    for (const q of [...Object.values(a.values), ...Object.values(b.values)])
      expect(text).not.toMatch(new RegExp(`\b${q.answer}\b`));
  });

  it("is a word, not a number, and the limits order the bands", () => {
    expect(bandFor(1)).toBe("strong");
    expect(bandFor(BAND_LIMITS.strong)).toBe("strong");
    expect(bandFor(BAND_LIMITS.good)).toBe("good");
    expect(bandFor(0)).toBe("some");
    const d = buildMatchDetail(a, b, cfg);
    expect(d.bandText).not.toMatch(/\d/);
  });

  it("does not use deal-breaker flags of the other person", () => {
    const flipped = toMember(
      user("c", {
        values: Object.fromEntries(
          Object.entries(b.values).map(([k, v]) => [
            k,
            { ...v, dealBreaker: !v.dealBreaker },
          ]),
        ),
      }),
    );
    const one = buildMatchDetail(a, b, cfg).lines;
    const two = buildMatchDetail(a, flipped, cfg).lines;
    expect(two).toEqual(one);
  });
});
