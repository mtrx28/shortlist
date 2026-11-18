import { describe, expect, it } from "vitest";
import { CONVERSATION_CONFIG } from "@/config/conversation";
import {
  demoControlsEnabled,
  demoGuard,
  shiftedTimes,
} from "@/lib/conversation/demo";
import {
  listBadge,
  previewText,
  threadView,
  toConv,
  type ConversationSnapshot,
} from "@/lib/conversation/view";
import { phaseOf } from "@/lib/conversation/state";

const HOUR = 3600 * 1000;
const OPENED = new Date("2026-11-16T10:00:00Z");
const at = (hours: number) => new Date(OPENED.getTime() + hours * HOUR);

function snap(over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    id: "c1",
    other_id: "p",
    opener_id: "me",
    status: "open",
    opened_at: OPENED.toISOString(),
    window_ends_at: at(72).toISOString(),
    closed_reason: null,
    closed_by: null,
    my_decision: null,
    i_sent: 0,
    they_sent: 0,
    unavailable: false,
    server_now: OPENED.toISOString(),
    ...over,
  };
}

describe("threadView: who can write", () => {
  it("the opener can write first", () => {
    const v = threadView(snap(), "me", at(1));
    expect(v.phase).toBe("awaiting_opener");
    expect(v.canCompose).toBe(true);
  });

  it("the other person has to wait for the opener", () => {
    const v = threadView(snap({ opener_id: "p" }), "me", at(1));
    expect(v.canCompose).toBe(false);
    expect(v.composeOffReason).toMatch(/write first/i);
  });

  it("the opener stops after the allowed messages until a reply", () => {
    const ok = threadView(
      snap({ i_sent: CONVERSATION_CONFIG.maxMessagesBeforeReply - 1 }),
      "me",
      at(1),
    );
    expect(ok.canCompose).toBe(true);
    const stuck = threadView(
      snap({ i_sent: CONVERSATION_CONFIG.maxMessagesBeforeReply }),
      "me",
      at(1),
    );
    expect(stuck.canCompose).toBe(false);
    expect(stuck.composeOffReason).toMatch(/reply first/i);
  });

  it("the other person can reply once the opener wrote", () => {
    const v = threadView(snap({ opener_id: "p", they_sent: 1 }), "me", at(1));
    expect(v.phase).toBe("awaiting_reply");
    expect(v.canCompose).toBe(true);
  });

  it.each(["closed", "expired"] as const)(
    "nobody writes in a %s chat",
    (status) => {
      const v = threadView(
        snap({ status, i_sent: 1, they_sent: 1 }),
        "me",
        at(5),
      );
      expect(v.canCompose).toBe(false);
      expect(v.readOnly).toBe(true);
      expect(v.composeOffReason).toBeTruthy();
    },
  );

  it("a chat whose time is up is read-only before the job has run", () => {
    const v = threadView(snap({ i_sent: 1, they_sent: 1 }), "me", at(73));
    expect(v.phase).toBe("timed_out");
    expect(v.canCompose).toBe(false);
  });

  it("a kept chat can always be written in", () => {
    const v = threadView(
      snap({ status: "kept", i_sent: 1, they_sent: 1 }),
      "me",
      at(900),
    );
    expect(v.canCompose).toBe(true);
    expect(v.showWindowCountdown).toBe(false);
  });

  it("an unavailable chat has no composer", () => {
    const v = threadView(
      snap({ i_sent: 1, they_sent: 1, unavailable: true }),
      "me",
      at(5),
    );
    expect(v.canCompose).toBe(false);
  });
});

describe("threadView: the day-3 decision", () => {
  const talking = { i_sent: 1, they_sent: 1 };

  it("is hidden before day 3 and shown from then on", () => {
    expect(threadView(snap(talking), "me", at(20)).showDecision).toBe(false);
    expect(threadView(snap(talking), "me", at(47.9)).showDecision).toBe(false);
    expect(threadView(snap(talking), "me", at(48)).showDecision).toBe(true);
    expect(threadView(snap(talking), "me", at(71)).showDecision).toBe(true);
  });

  it("is hidden when only one person has written", () => {
    expect(
      threadView(snap({ i_sent: 2, they_sent: 0 }), "me", at(60)).showDecision,
    ).toBe(false);
  });

  it("is hidden once it is over", () => {
    expect(threadView(snap(talking), "me", at(72)).showDecision).toBe(false);
    expect(
      threadView(snap({ ...talking, status: "kept" }), "me", at(60))
        .showDecision,
    ).toBe(false);
  });

  it("remembers my own choice, never the other person's", () => {
    const v = threadView(
      snap({ ...talking, my_decision: "keep" }),
      "me",
      at(60),
    );
    expect(v.myDecision).toBe("keep");
  });
});

describe("threadView: the 48 hour reminder", () => {
  it("goes to the opener who has not written", () => {
    const v = threadView(snap(), "me", at(49));
    expect(v.nudge).not.toBeNull();
    expect(v.nudge?.hoursLeft).toBe(23);
  });

  it("goes to the other person who has not replied", () => {
    const v = threadView(snap({ opener_id: "p", they_sent: 1 }), "me", at(60));
    expect(v.nudge?.hoursLeft).toBe(12);
  });

  it("does not go to the person who is waiting", () => {
    expect(threadView(snap({ i_sent: 1 }), "me", at(60)).nudge).toBeNull(); // opener, waiting for a reply
    expect(threadView(snap({ opener_id: "p" }), "me", at(60)).nudge).toBeNull(); // other, waiting for the opener
  });

  it("does not appear before 48 hours or after the end", () => {
    expect(threadView(snap(), "me", at(47)).nudge).toBeNull();
    expect(threadView(snap(), "me", at(72)).nudge).toBeNull();
  });

  it("does not appear once both have written", () => {
    expect(
      threadView(snap({ i_sent: 1, they_sent: 1 }), "me", at(60)).nudge,
    ).toBeNull();
  });

  it("rounds the hours left up", () => {
    expect(threadView(snap(), "me", at(71.5)).nudge?.hoursLeft).toBe(1);
  });
});

describe("toConv", () => {
  it("puts me first and does not know their decision", () => {
    const c = toConv(
      snap({ my_decision: "keep", i_sent: 2, they_sent: 1 }),
      "me",
    );
    expect(c).toMatchObject({
      userA: "me",
      userB: "p",
      sentA: 2,
      sentB: 1,
      aDecision: "keep",
      bDecision: null,
    });
    expect(phaseOf(c, at(60))).toBe("deciding");
  });
});

describe("listBadge", () => {
  const base = toConv(snap(), "me");
  it.each([
    ["opener, nobody wrote", base, "me", 1, "Your turn: say hello", "action"],
    [
      "other, nobody wrote",
      base,
      "p",
      1,
      "Waiting for them to write",
      "waiting",
    ],
    [
      "opener, waiting for a reply",
      { ...base, sentA: 1 },
      "me",
      1,
      "Waiting for a reply",
      "waiting",
    ],
    [
      "other, owes a reply",
      { ...base, sentA: 1 },
      "p",
      1,
      "Your turn: reply",
      "action",
    ],
    ["chatting", { ...base, sentA: 1, sentB: 1 }, "me", 10, "Chatting", "calm"],
    [
      "deciding",
      { ...base, sentA: 1, sentB: 1 },
      "me",
      50,
      "Time to decide",
      "action",
    ],
    ["kept", { ...base, status: "kept" as const }, "me", 5, "Kept", "calm"],
    [
      "closed",
      { ...base, status: "closed" as const },
      "me",
      5,
      "Closed kindly",
      "ended",
    ],
    [
      "expired",
      { ...base, status: "expired" as const },
      "me",
      5,
      "Time ran out",
      "ended",
    ],
    ["timed out", { ...base, sentA: 1 }, "me", 80, "Time ran out", "ended"],
  ] as const)("%s", (_n, conv, who, hours, label, tone) => {
    expect(listBadge(conv, who, at(hours))).toEqual({ label, tone });
  });
});

describe("previewText", () => {
  it("is empty for nothing", () => {
    expect(previewText(null)).toBe("");
    expect(previewText("")).toBe("");
  });
  it("keeps a short message and flattens whitespace", () => {
    expect(previewText("Hi\n  there")).toBe("Hi there");
  });
  it("cuts a long message at a word", () => {
    const text = "word ".repeat(40);
    const out = previewText(text, 30);
    expect(out.endsWith("...")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(33);
    expect(out).not.toMatch(/wor\.\.\.$/);
  });
});

// ---------------------------------------------------------------------------
// Demo controls
// ---------------------------------------------------------------------------
describe("demo controls", () => {
  const allowed = {
    enabled: true,
    actorId: "me",
    actorIsAdmin: false,
    userA: "me",
    userB: "p",
    demoAccounts: { me: true, p: true },
  };

  it("is off unless DEMO_CONTROLS is exactly true", () => {
    expect(demoControlsEnabled({})).toBe(false);
    expect(demoControlsEnabled({ DEMO_CONTROLS: "false" })).toBe(false);
    expect(demoControlsEnabled({ DEMO_CONTROLS: "TRUE" })).toBe(false);
    expect(demoControlsEnabled({ DEMO_CONTROLS: "1" })).toBe(false);
    expect(demoControlsEnabled({ DEMO_CONTROLS: "true" })).toBe(true);
  });

  it("works when the flag is on and a demo account is in the chat", () => {
    expect(demoGuard(allowed)).toEqual({ ok: true });
    // One demo account is enough.
    expect(
      demoGuard({ ...allowed, demoAccounts: { me: false, p: true } }),
    ).toEqual({
      ok: true,
    });
  });

  it("refuses when the flag is off, whatever else is true", () => {
    expect(demoGuard({ ...allowed, enabled: false })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("refuses when no demo account is involved", () => {
    expect(
      demoGuard({ ...allowed, demoAccounts: { me: false, p: false } }),
    ).toEqual({ ok: false, reason: "not_demo" });
    expect(demoGuard({ ...allowed, demoAccounts: {} })).toEqual({
      ok: false,
      reason: "not_demo",
    });
  });

  it("refuses someone who is not in the chat, unless an admin", () => {
    const outsider = { ...allowed, actorId: "x" };
    expect(demoGuard(outsider)).toEqual({ ok: false, reason: "not_allowed" });
    expect(demoGuard({ ...outsider, actorIsAdmin: true })).toEqual({
      ok: true,
    });
  });
});

describe("demo clock shifts", () => {
  const NOW = new Date("2026-11-18T10:00:00Z");
  const fresh = {
    openedAt: new Date(NOW.getTime() - 1 * HOUR),
    windowEndsAt: new Date(NOW.getTime() + 71 * HOUR),
  };

  it("day3: puts the chat 49 hours in", () => {
    const t = shiftedTimes("day3", NOW, fresh);
    expect(NOW.getTime() - t.openedAt.getTime()).toBe(49 * HOUR);
    expect(t.windowEndsAt.getTime() - NOW.getTime()).toBe(23 * HOUR);
  });

  it("almost_over: leaves 4 hours", () => {
    const t = shiftedTimes("almost_over", NOW, fresh);
    expect(t.windowEndsAt.getTime() - NOW.getTime()).toBe(4 * HOUR);
    expect(t.windowEndsAt.getTime() - t.openedAt.getTime()).toBe(72 * HOUR);
  });

  it("expire: the window ended a minute ago", () => {
    const t = shiftedTimes("expire", NOW, fresh);
    expect(NOW.getTime() - t.windowEndsAt.getTime()).toBe(60_000);
  });

  it("never moves the clock backwards", () => {
    const old = {
      openedAt: new Date(NOW.getTime() - 70 * HOUR),
      windowEndsAt: new Date(NOW.getTime() + 2 * HOUR),
    };
    expect(shiftedTimes("day3", NOW, old)).toEqual(old);
    expect(shiftedTimes("almost_over", NOW, old)).toEqual(old);
  });

  it("the day3 step really reaches the decision stage", () => {
    const t = shiftedTimes("day3", NOW, fresh);
    const c = toConv(
      snap({
        opened_at: t.openedAt.toISOString(),
        window_ends_at: t.windowEndsAt.toISOString(),
        i_sent: 1,
        they_sent: 1,
      }),
      "me",
    );
    expect(phaseOf(c, NOW)).toBe("deciding");
  });

  it("the expire step really makes the window end", () => {
    const t = shiftedTimes("expire", NOW, fresh);
    const c = toConv(
      snap({
        opened_at: t.openedAt.toISOString(),
        window_ends_at: t.windowEndsAt.toISOString(),
      }),
      "me",
    );
    expect(phaseOf(c, NOW)).toBe("timed_out");
  });
});
