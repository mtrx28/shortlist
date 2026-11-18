import { describe, expect, it } from "vitest";
import { REPORT_REASONS, SAFETY_CONFIG, reasonLabel } from "@/config/safety";
import {
  currentConsents,
  needsReconsent,
  type ConsentRow,
} from "@/lib/account/consents";
import { safetyHashSecret } from "@/lib/account/secret";
import { isSameOrigin } from "@/lib/same-origin";
import { ageText, slaState } from "@/lib/safety/sla";
import {
  blockSchema,
  contactSchema,
  endChatSchema,
  reportSchema,
} from "@/lib/validators/safety";

const HOUR = 3600 * 1000;
const now = new Date("2026-11-20T12:00:00Z");
const ago = (hours: number) =>
  new Date(now.getTime() - hours * HOUR).toISOString();

describe("report age and the draft targets", () => {
  it("formats the age", () => {
    expect(ageText(ago(0.5), now)).toBe("30 min");
    expect(ageText(ago(5), now)).toBe("5 h");
    expect(ageText(ago(52), now)).toBe("2 d 4 h");
    expect(ageText(ago(-3), now)).toBe("0 min"); // a clock in the future is never negative
  });

  it("flags an open report that is not acknowledged in time", () => {
    const base = { ack_at: null, resolved_at: null };
    expect(
      slaState({ ...base, status: "open", created_at: ago(23) }, now),
    ).toBe("ok");
    expect(
      slaState({ ...base, status: "open", created_at: ago(25) }, now),
    ).toBe("ack_overdue");
    // Acknowledged reports are no longer "ack overdue".
    expect(slaState({ ...base, status: "ack", created_at: ago(25) }, now)).toBe(
      "ok",
    );
  });

  it("flags anything not finished after the resolve target, and finished ones are done", () => {
    const base = { ack_at: ago(1), resolved_at: null };
    const late = SAFETY_CONFIG.resolveWithinDays * 24 + 1;
    expect(
      slaState({ ...base, status: "ack", created_at: ago(late) }, now),
    ).toBe("resolve_overdue");
    expect(
      slaState({ ...base, status: "actioned", created_at: ago(late) }, now),
    ).toBe("done");
    expect(
      slaState({ ...base, status: "dismissed", created_at: ago(late) }, now),
    ).toBe("done");
  });
});

describe("consents", () => {
  const row = (
    kind: ConsentRow["kind"],
    version: string,
    granted: boolean,
    day: number,
  ): ConsentRow => ({
    kind,
    policy_version: version,
    granted,
    at: new Date(Date.UTC(2026, 10, day)).toISOString(),
  });

  it("takes the newest row for each kind", () => {
    const now2 = currentConsents([
      row("marketing", "v1", true, 1),
      row("marketing", "v1", false, 5),
      row("terms", "v1", true, 1),
    ]);
    expect(now2.find((c) => c.kind === "marketing")?.granted).toBe(false);
    expect(now2.find((c) => c.kind === "terms")?.granted).toBe(true);
  });

  it("asks again when the Terms or Privacy version moved on", () => {
    const rows = [row("terms", "v1", true, 1), row("privacy", "v1", true, 1)];
    expect(needsReconsent(rows, "v1")).toBe(false);
    expect(needsReconsent(rows, "v2")).toBe(true);
    expect(needsReconsent([row("terms", "v2", true, 1)], "v2")).toBe(true); // privacy missing
    expect(
      needsReconsent(
        [...rows, row("terms", "v2", true, 3), row("privacy", "v2", true, 3)],
        "v2",
      ),
    ).toBe(false);
  });
});

describe("small guards", () => {
  it("accepts a missing Origin and the same host, refuses another site", () => {
    expect(isSameOrigin(null, "app.example")).toBe(true);
    expect(isSameOrigin("https://app.example", "app.example")).toBe(true);
    expect(isSameOrigin("https://evil.example", "app.example")).toBe(false);
    expect(isSameOrigin("not a url", "app.example")).toBe(false);
    expect(isSameOrigin("https://app.example", null)).toBe(false);
  });

  it("needs a long enough secret for the safety hash", () => {
    expect(safetyHashSecret({})).toBeNull();
    expect(safetyHashSecret({ SAFETY_HASH_SECRET: "short" })).toBeNull();
    expect(safetyHashSecret({ ELITMUS_HASH_SECRET: "x".repeat(20) })).toBe(
      "x".repeat(20),
    );
    expect(
      safetyHashSecret({
        SAFETY_HASH_SECRET: "y".repeat(16),
        ELITMUS_HASH_SECRET: "x".repeat(20),
      }),
    ).toBe("y".repeat(16));
  });
});

describe("safety validators", () => {
  const uuid = "6f1d3a0e-3a58-4c70-9a8e-1b2c3d4e5f60";
  it("block needs a uuid", () => {
    expect(blockSchema.safeParse({ targetId: uuid }).success).toBe(true);
    expect(blockSchema.safeParse({ targetId: "x" }).success).toBe(false);
  });
  it("report needs a known reason and short details", () => {
    expect(
      reportSchema.safeParse({ targetId: uuid, reason: "scam" }).success,
    ).toBe(true);
    expect(
      reportSchema.safeParse({ targetId: uuid, reason: "nonsense" }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({
        targetId: uuid,
        reason: "other",
        details: "x".repeat(1001),
      }).success,
    ).toBe(false);
    for (const r of REPORT_REASONS) expect(reasonLabel(r.id)).not.toBe(r.id);
  });
  it("ending a chat needs a template id, not free text", () => {
    expect(
      endChatSchema.safeParse({ conversationId: uuid, templateId: "thanks" })
        .success,
    ).toBe(true);
    expect(endChatSchema.safeParse({ conversationId: uuid }).success).toBe(
      false,
    );
  });
  it("contact form checks email and length", () => {
    expect(
      contactSchema.safeParse({
        name: "A",
        email: "a@b.co",
        message: "Hello there, friend",
      }).success,
    ).toBe(true);
    expect(
      contactSchema.safeParse({
        name: "A",
        email: "bad",
        message: "Hello there, friend",
      }).success,
    ).toBe(false);
    expect(
      contactSchema.safeParse({ name: "A", email: "a@b.co", message: "short" })
        .success,
    ).toBe(false);
  });
});
