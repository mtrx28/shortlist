import { describe, expect, it } from "vitest";
import {
  buildMetricCards,
  parseRawMetrics,
  percent,
  rupees,
  type RawMetrics,
} from "@/lib/admin/metrics";

const raw: RawMetrics = {
  members: 20,
  verified: 5,
  active_chats: 4,
  intros_delivered: 60,
  replies_owed: 8,
  replies_sent: 6,
  kept_chats: 1,
  closed_chats: 3,
  expired_chats: 2,
  plus_members: 2,
  paid_orders: 2,
  revenue_paise: 69800,
};

describe("percent", () => {
  it("rounds and never divides by zero", () => {
    expect(percent(1, 3)).toBe("33%");
    expect(percent(2, 3)).toBe("67%");
    expect(percent(0, 0)).toBe("-");
    expect(percent(5, -1)).toBe("-");
  });
});

describe("rupees", () => {
  it("shows whole rupees with Indian grouping", () => {
    expect(rupees(19900)).toBe("Rs 199");
    expect(rupees(0)).toBe("Rs 0");
    expect(rupees(123456700)).toBe("Rs 12,34,567");
  });
});

describe("parseRawMetrics", () => {
  it("rejects things that are not objects", () => {
    expect(parseRawMetrics(null)).toBeNull();
    expect(parseRawMetrics("x")).toBeNull();
    expect(parseRawMetrics(undefined)).toBeNull();
  });
  it("turns strings, junk and negatives into safe whole numbers", () => {
    const out = parseRawMetrics({
      members: "12",
      verified: -3,
      active_chats: "abc",
      intros_delivered: 7.9,
    });
    expect(out?.members).toBe(12);
    expect(out?.verified).toBe(0);
    expect(out?.active_chats).toBe(0);
    expect(out?.intros_delivered).toBe(7);
    expect(out?.revenue_paise).toBe(0);
  });
});

describe("buildMetricCards", () => {
  const cards = buildMetricCards(raw);
  const get = (id: string) => cards.find((c) => c.id === id)!;

  it("has the eight cards the dashboard promises", () => {
    expect(cards.map((c) => c.id)).toEqual([
      "members",
      "verified",
      "active-chats",
      "intros",
      "reply-rate",
      "keep-close",
      "plus",
      "revenue",
    ]);
  });
  it("works out reply rate, keep share and revenue", () => {
    expect(get("reply-rate").value).toBe("75%");
    expect(get("keep-close").value).toBe("1 / 3");
    expect(get("keep-close").note).toBe("25% kept");
    expect(get("revenue").value).toBe("Rs 698");
    expect(get("revenue").label).toContain("test mode");
    expect(get("verified").note).toBe("25% of members");
  });
  it("shows dashes instead of invented numbers on an empty database", () => {
    const empty = buildMetricCards(parseRawMetrics({})!);
    expect(empty.find((c) => c.id === "reply-rate")!.value).toBe("-");
    expect(empty.find((c) => c.id === "keep-close")!.note).toBe(
      "no decisions yet",
    );
    expect(empty.find((c) => c.id === "revenue")!.value).toBe("Rs 0");
  });
});
