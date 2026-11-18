import { describe, expect, it } from "vitest";
import {
  CLOSE_TEMPLATES,
  CONVERSATION_CONFIG,
  SAFE_MEET_TIPS,
  closeTemplateText,
} from "@/config/conversation";
import {
  EXPIRY_REASONS,
  decisionOpensAt,
  expiryReason,
  nextState,
  phaseOf,
  replyRateDeltas,
  type Conv,
  type ConvEvent,
} from "@/lib/conversation/state";

const HOUR = 3600 * 1000;
const OPENED = new Date("2026-11-16T10:00:00Z");
const at = (hours: number) => new Date(OPENED.getTime() + hours * HOUR);

// opener "o", other "p". The opener is user A unless stated.
function conv(over: Partial<Conv> = {}): Conv {
  return {
    status: "open",
    userA: "o",
    userB: "p",
    openerId: "o",
    openedAt: OPENED,
    windowEndsAt: at(72),
    sentA: 0,
    sentB: 0,
    aDecision: null,
    bDecision: null,
    closedReason: null,
    closedBy: null,
    ...over,
  };
}

const both = (over: Partial<Conv> = {}) =>
  conv({ sentA: 1, sentB: 1, ...over });

describe("phaseOf", () => {
  it.each([
    ["nobody wrote", conv(), 1, "awaiting_opener"],
    ["opener wrote", conv({ sentA: 1 }), 1, "awaiting_reply"],
    ["both wrote on day 1", both(), 10, "chatting"],
    ["both wrote, 47h in", both(), 47.99, "chatting"],
    ["both wrote, exactly 48h in", both(), 48, "deciding"],
    ["both wrote on day 3", both(), 60, "deciding"],
    ["window over", both(), 72, "timed_out"],
    ["window over, nobody wrote", conv(), 100, "timed_out"],
    ["kept", both({ status: "kept" }), 500, "kept"],
    ["closed", both({ status: "closed" }), 10, "closed"],
    ["blocked counts as closed", both({ status: "blocked" }), 10, "closed"],
    ["expired", conv({ status: "expired" }), 100, "expired"],
  ] as const)("%s", (_n, c, hours, phase) => {
    expect(phaseOf(c, at(hours))).toBe(phase);
  });

  it("works when the opener is user B", () => {
    const c = conv({ openerId: "p", sentA: 0, sentB: 1 });
    expect(phaseOf(c, at(2))).toBe("awaiting_reply");
  });

  it("decision opens at the configured hour", () => {
    expect(decisionOpensAt(conv()).getTime()).toBe(
      OPENED.getTime() + CONVERSATION_CONFIG.decisionOpensAfterHours * HOUR,
    );
  });
});

// Every message case.
describe("nextState: message", () => {
  type Case = [string, Conv, string, number, string | "ok", Partial<Conv>?];
  const cases: Case[] = [
    ["opener writes first", conv(), "o", 1, "ok", { sentA: 1 }],
    ["other cannot write first", conv(), "p", 1, "wait_for_opener"],
    ["stranger", conv(), "x", 1, "not_participant"],
    ["other replies", conv({ sentA: 1 }), "p", 2, "ok", { sentB: 1 }],
    [
      "opener writes a second message before a reply",
      conv({ sentA: 1 }),
      "o",
      2,
      "ok",
      { sentA: 2 },
    ],
    [
      "opener over the limit before a reply",
      conv({ sentA: CONVERSATION_CONFIG.maxMessagesBeforeReply }),
      "o",
      2,
      "wait_for_reply",
    ],
    [
      "opener after the other replied is not limited",
      conv({ sentA: 10, sentB: 1 }),
      "o",
      2,
      "ok",
      { sentA: 11 },
    ],
    ["day 3, both can write", both(), "p", 50, "ok", { sentB: 2 }],
    ["window just ended", both(), "o", 72, "window_ended"],
    ["after the window", conv(), "o", 80, "window_ended"],
    ["just before the window ends", conv(), "o", 71.99, "ok", { sentA: 1 }],
    ["closed chat", both({ status: "closed" }), "o", 5, "not_open"],
    ["expired chat", conv({ status: "expired" }), "o", 5, "not_open"],
    ["blocked chat", both({ status: "blocked" }), "o", 5, "not_open"],
    [
      "kept chat after the old window",
      both({ status: "kept" }),
      "p",
      400,
      "ok",
      { sentB: 2 },
    ],
  ];

  it.each(cases)("%s", (_n, c, from, hours, expected, patch) => {
    const result = nextState(c, { type: "message", from }, at(hours));
    if (expected === "ok") {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.changed).toBe(true);
        expect(result.ended).toBe(false);
        expect(result.conv).toEqual({ ...c, ...patch });
      }
    } else {
      expect(result).toEqual({ ok: false, error: expected });
    }
  });

  it("a blocked or suspended person cannot send, even in a live chat", () => {
    expect(
      nextState(both(), { type: "message", from: "o" }, at(5), {
        unavailable: true,
      }),
    ).toEqual({ ok: false, error: "unavailable" });
  });

  it("does not change the input", () => {
    const c = conv();
    const copy = JSON.stringify(c);
    nextState(c, { type: "message", from: "o" }, at(1));
    expect(JSON.stringify(c)).toBe(copy);
  });
});

describe("nextState: decisions", () => {
  const decide = (
    c: Conv,
    by: string,
    decision: string,
    hours = 50,
    note: string | null = "kind note",
  ) => nextState(c, { type: "decide", by, decision, note }, at(hours));

  it("first keep waits for the other person", () => {
    const r = decide(both(), "o", "keep");
    expect(r).toMatchObject({ ok: true, changed: true, ended: false });
    if (r.ok) {
      expect(r.conv.status).toBe("open");
      expect(r.conv.aDecision).toBe("keep");
      expect(r.conv.bDecision).toBeNull();
    }
  });

  it("keep and keep keeps the chat", () => {
    const first = decide(both(), "o", "keep");
    if (!first.ok) throw new Error("setup");
    const second = decide(first.conv, "p", "keep");
    expect(second).toMatchObject({ ok: true, changed: true, ended: true });
    if (second.ok) {
      expect(second.conv.status).toBe("kept");
      expect(second.conv.bDecision).toBe("keep");
    }
  });

  it("keep from user B first, then A", () => {
    const first = decide(both(), "p", "keep");
    if (!first.ok) throw new Error("setup");
    expect(first.conv.bDecision).toBe("keep");
    const second = decide(first.conv, "o", "keep");
    if (second.ok) expect(second.conv.status).toBe("kept");
  });

  it("close ends the chat at once with the note and who closed", () => {
    const r = decide(both(), "p", "close");
    expect(r).toMatchObject({ ok: true, changed: true, ended: true });
    if (r.ok) {
      expect(r.conv.status).toBe("closed");
      expect(r.conv.closedBy).toBe("p");
      expect(r.conv.closedReason).toBe("kind note");
      expect(r.conv.bDecision).toBe("close");
    }
  });

  it("keep then close: close wins", () => {
    const first = decide(both(), "o", "keep");
    if (!first.ok) throw new Error("setup");
    const second = decide(first.conv, "p", "close");
    if (second.ok) expect(second.conv.status).toBe("closed");
  });

  it("my own keep can be changed to close", () => {
    const first = decide(both(), "o", "keep");
    if (!first.ok) throw new Error("setup");
    const second = decide(first.conv, "o", "close");
    if (second.ok) {
      expect(second.conv.status).toBe("closed");
      expect(second.conv.aDecision).toBe("close");
    }
  });

  it("a repeated keep changes nothing", () => {
    const first = decide(both(), "o", "keep");
    if (!first.ok) throw new Error("setup");
    const again = decide(first.conv, "o", "keep");
    expect(again).toMatchObject({ ok: true, changed: false, ended: false });
  });

  it("close without a note stores no reason", () => {
    const r = decide(both(), "o", "close", 50, null);
    if (r.ok) expect(r.conv.closedReason).toBeNull();
  });

  it.each([
    [
      "not both written (only opener)",
      conv({ sentA: 3 }),
      "o",
      "keep",
      50,
      "decision_not_open",
    ],
    ["nobody wrote", conv(), "o", "close", 50, "decision_not_open"],
    ["day 3 has not started", both(), "o", "keep", 47, "decision_not_open"],
    ["window over", both(), "o", "keep", 72, "window_ended"],
    ["stranger", both(), "x", "keep", 50, "not_participant"],
    ["bad decision text", both(), "o", "maybe", 50, "bad_decision"],
    ["empty decision text", both(), "o", "", 50, "bad_decision"],
    ["already kept", both({ status: "kept" }), "o", "keep", 50, "not_open"],
    [
      "already closed",
      both({ status: "closed" }),
      "o",
      "close",
      50,
      "not_open",
    ],
    [
      "already expired",
      both({ status: "expired" }),
      "o",
      "keep",
      50,
      "not_open",
    ],
  ] as const)("refuses: %s", (_n, c, by, decision, hours, error) => {
    expect(decide(c, by, decision, hours)).toEqual({ ok: false, error });
  });

  it("refuses when the chat is unavailable", () => {
    expect(
      nextState(both(), { type: "decide", by: "o", decision: "keep" }, at(50), {
        unavailable: true,
      }),
    ).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("nextState: the expiry job", () => {
  const tick: ConvEvent = { type: "tick" };

  it.each([
    ["nobody wrote", conv(), EXPIRY_REASONS.noFirstMessage],
    ["only the opener wrote", conv({ sentA: 2 }), EXPIRY_REASONS.noReply],
    ["both wrote, no decisions", both(), EXPIRY_REASONS.noDecision],
    [
      "both wrote, one keep",
      both({ aDecision: "keep" }),
      EXPIRY_REASONS.noDecision,
    ],
  ])("expires when time is up: %s", (_n, c, reason) => {
    const r = nextState(c, tick, at(72));
    expect(r).toMatchObject({ ok: true, changed: true, ended: true });
    if (r.ok) {
      expect(r.conv.status).toBe("expired");
      expect(r.conv.closedReason).toBe(reason);
      expect(expiryReason(c)).toBe(reason);
    }
  });

  it("does nothing before the time is up", () => {
    expect(nextState(conv(), tick, at(71.9))).toMatchObject({
      ok: true,
      changed: false,
      ended: false,
    });
  });

  it.each(["kept", "closed", "expired"] as const)(
    "does nothing to a %s chat",
    (status) => {
      expect(nextState(both({ status }), tick, at(500))).toMatchObject({
        ok: true,
        changed: false,
        ended: false,
      });
    },
  );

  it("is idempotent: expiring twice changes nothing the second time", () => {
    const first = nextState(conv(), tick, at(80));
    if (!first.ok) throw new Error("setup");
    const second = nextState(first.conv, tick, at(81));
    expect(second).toMatchObject({ ok: true, changed: false });
  });
});

describe("replyRateDeltas", () => {
  it("both wrote: both reply", () => {
    expect(replyRateDeltas(both())).toEqual([
      { userId: "o", num: 1, den: 1 },
      { userId: "p", num: 1, den: 1 },
    ]);
  });

  it("opener wrote, other never replied: counts against the other", () => {
    expect(replyRateDeltas(conv({ sentA: 2 }))).toEqual([
      { userId: "o", num: 1, den: 1 },
      { userId: "p", num: 0, den: 1 },
    ]);
  });

  it("opener never wrote: counts against the opener only", () => {
    expect(replyRateDeltas(conv())).toEqual([{ userId: "o", num: 0, den: 1 }]);
  });

  it("works when the opener is user B", () => {
    expect(
      replyRateDeltas(conv({ openerId: "p", sentA: 1, sentB: 0 })),
    ).toEqual([{ userId: "p", num: 0, den: 1 }]);
  });
});

describe("config", () => {
  it("has close notes that are short, unique and blame nobody", () => {
    const ids = CLOSE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of CLOSE_TEMPLATES) {
      expect(t.text.length).toBeLessThanOrEqual(200); // closed_reason limit
      expect(t.text).not.toMatch(/ghost|fault|blame|your fault|you failed/i);
      expect(closeTemplateText(t.id)).toBe(t.text);
    }
  });

  it("only knows its own notes", () => {
    expect(closeTemplateText("write-your-own")).toBeNull();
    expect(closeTemplateText("")).toBeNull();
  });

  it("opens the decision inside the reply window", () => {
    expect(CONVERSATION_CONFIG.decisionOpensAfterHours).toBeLessThan(72);
    expect(SAFE_MEET_TIPS.length).toBeGreaterThan(0);
  });
});
