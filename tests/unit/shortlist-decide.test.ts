import { describe, expect, it } from "vitest";
import { chooseOpener, decideIntro, type Gender } from "@/lib/shortlist/decide";
import { input, type Overrides } from "./shortlist-fixtures";
import { noticeFor } from "@/lib/shortlist/messages";
import { outcomeFromError, outcomeFromResult } from "@/lib/shortlist/service";

// The pure rulebook for answering an intro. tests/rls/shortlist.test.ts runs
// the same cases through the real database function.

const OPTIONS = { womanOpens: true };

const decide = (o: Overrides = {}) => decideIntro(input(o), OPTIONS);

describe("who can answer", () => {
  it("rejects an intro that does not exist", () => {
    expect(decide({ noIntro: true })).toEqual({
      kind: "rejected",
      reason: "not_found",
    });
  });

  it("rejects someone else's intro with the same answer as a missing one", () => {
    expect(decide({ owner: "somebody-else" })).toEqual({
      kind: "rejected",
      reason: "not_found",
    });
  });

  it("rejects a viewer who is paused or not set up", () => {
    expect(decide({ viewerAvailable: false })).toEqual({
      kind: "rejected",
      reason: "viewer_unavailable",
    });
  });

  it("rejects an intro whose week is over, even a repeat answer", () => {
    expect(decide({ expired: true })).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    expect(decide({ expired: true, status: "interested" })).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    expect(decide({ status: "expired", decision: "passed" })).toEqual({
      kind: "rejected",
      reason: "expired",
    });
  });
});

describe("passing", () => {
  it("is recorded and says nothing about the other person", () => {
    expect(decide({ decision: "passed" })).toEqual({ kind: "passed" });
    // Even when the other person is interested, a pass looks the same.
    expect(decide({ decision: "passed", otherIntro: "interested" })).toEqual({
      kind: "passed",
    });
  });

  it("can be repeated (double click)", () => {
    expect(decide({ decision: "passed", status: "passed" })).toEqual({
      kind: "passed",
    });
  });

  it("cannot undo an Interested", () => {
    expect(decide({ decision: "passed", status: "interested" })).toEqual({
      kind: "rejected",
      reason: "already_decided",
    });
  });

  it("works even at the chat cap", () => {
    expect(decide({ decision: "passed", viewerChats: 3 })).toEqual({
      kind: "passed",
    });
  });
});

describe("Interested: opening a chat needs both people", () => {
  it("man first: his interest alone does not open a chat", () => {
    expect(decide({ otherIntro: "new" })).toEqual({
      kind: "interest_saved",
      reason: "waiting",
    });
  });

  it("man first, and she passed: looks exactly like waiting", () => {
    expect(decide({ otherIntro: "passed" })).toEqual({
      kind: "interest_saved",
      reason: "waiting",
    });
  });

  it("man after woman: opens, and she is the opener", () => {
    expect(decide({ otherIntro: "interested" })).toEqual({
      kind: "opened",
      opener: "other",
    });
  });

  it("woman after man: opens, and she is the opener", () => {
    expect(
      decide({
        viewerGender: "woman",
        otherGender: "man",
        otherIntro: "interested",
      }),
    ).toEqual({ kind: "opened", opener: "viewer" });
  });

  it("woman first: her interest alone does not open a chat", () => {
    expect(
      decide({ viewerGender: "woman", otherGender: "man", otherIntro: "new" }),
    ).toEqual({ kind: "interest_saved", reason: "waiting" });
  });

  it("woman first, then man: the man's click opens it (the rule never blocks mutual interest)", () => {
    // Her answer came first (1000), his is now (2000).
    expect(
      decide({
        viewerGender: "man",
        otherGender: "woman",
        otherIntro: "interested",
        viewerDecidedAt: 2000,
        otherDecidedAt: 1000,
      }),
    ).toEqual({ kind: "opened", opener: "other" });
  });

  it("two women: plain mutual interest, the earlier one opens", () => {
    expect(
      decide({
        viewerGender: "woman",
        otherGender: "woman",
        otherIntro: "interested",
      }),
    ).toEqual({ kind: "opened", opener: "other" });
    expect(
      decide({
        viewerGender: "woman",
        otherGender: "woman",
        otherIntro: "new",
      }),
    ).toEqual({ kind: "interest_saved", reason: "waiting" });
  });

  it("two men: plain mutual interest, the earlier one opens", () => {
    expect(
      decide({
        viewerGender: "man",
        otherGender: "man",
        otherIntro: "interested",
      }),
    ).toEqual({ kind: "opened", opener: "other" });
  });

  it.each<[Gender, Gender]>([
    ["non_binary", "woman"],
    ["woman", "non_binary"],
    ["non_binary", "man"],
    ["man", "non_binary"],
    ["non_binary", "non_binary"],
  ])("%s with %s: no woman-first rule, the earlier one opens", (v, o) => {
    expect(
      decide({ viewerGender: v, otherGender: o, otherIntro: "interested" }),
    ).toEqual({ kind: "opened", opener: "other" });
    expect(
      decide({ viewerGender: v, otherGender: o, otherIntro: "new" }),
    ).toEqual({ kind: "interest_saved", reason: "waiting" });
  });

  it("a missing gender is treated like any non man-woman pair", () => {
    expect(
      decide({
        viewerGender: null,
        otherGender: "woman",
        otherIntro: "interested",
      }),
    ).toEqual({ kind: "opened", opener: "other" });
  });

  it("the other person has no intro about me: stays waiting", () => {
    expect(decide({ otherIntro: null })).toEqual({
      kind: "interest_saved",
      reason: "waiting",
    });
  });
});

describe("Interested: repeats and double clicks", () => {
  it("a repeated Interested after the chat opened returns already_open", () => {
    expect(
      decide({
        status: "interested",
        otherIntro: "interested",
        liveChat: true,
      }),
    ).toEqual({ kind: "already_open" });
  });

  it("a repeated Interested while waiting stays waiting", () => {
    expect(decide({ status: "interested", otherIntro: "new" })).toEqual({
      kind: "interest_saved",
      reason: "waiting",
    });
  });

  it("a repeat is a retry: it opens once the other side has said yes", () => {
    expect(decide({ status: "interested", otherIntro: "interested" })).toEqual({
      kind: "opened",
      opener: "other",
    });
  });

  it("Interested after Pass is refused", () => {
    expect(decide({ status: "passed" })).toEqual({
      kind: "rejected",
      reason: "already_decided",
    });
  });
});

describe("the chat cap", () => {
  it("free: blocks a new Interested at 3 chats, and nothing is saved", () => {
    expect(decide({ viewerChats: 3, otherIntro: "interested" })).toEqual({
      kind: "viewer_at_cap",
    });
    // The same reply whether or not the other person is interested, so it
    // does not leak their answer.
    expect(decide({ viewerChats: 3, otherIntro: "new" })).toEqual({
      kind: "viewer_at_cap",
    });
  });

  it("free: 2 chats is still fine", () => {
    expect(decide({ viewerChats: 2, otherIntro: "interested" })).toEqual({
      kind: "opened",
      opener: "other",
    });
  });

  it("Plus: 5 chats allowed, blocked at 5", () => {
    expect(
      decide({ viewerChats: 4, viewerCap: 5, otherIntro: "interested" }),
    ).toEqual({ kind: "opened", opener: "other" });
    expect(
      decide({ viewerChats: 5, viewerCap: 5, otherIntro: "interested" }),
    ).toEqual({ kind: "viewer_at_cap" });
  });

  it("the other person at their cap: interest is saved, no chat, neutral reason", () => {
    expect(decide({ otherChats: 3, otherIntro: "interested" })).toEqual({
      kind: "interest_saved",
      reason: "other_at_cap",
    });
  });

  it("the other person on Plus at 3 chats still has room", () => {
    expect(
      decide({ otherChats: 3, otherCap: 5, otherIntro: "interested" }),
    ).toEqual({ kind: "opened", opener: "other" });
  });

  it("the other person at their cap, but not interested: just waiting", () => {
    expect(decide({ otherChats: 3, otherIntro: "new" })).toEqual({
      kind: "interest_saved",
      reason: "waiting",
    });
  });

  it("a retry while the viewer filled up since: viewer_at_cap", () => {
    expect(
      decide({
        status: "interested",
        viewerChats: 3,
        otherIntro: "interested",
      }),
    ).toEqual({ kind: "viewer_at_cap" });
  });

  it("an existing chat is reported even when the viewer is at the cap", () => {
    expect(
      decide({
        status: "interested",
        viewerChats: 3,
        otherIntro: "interested",
        liveChat: true,
      }),
    ).toEqual({ kind: "already_open" });
  });
});

describe("blocks and unavailable people", () => {
  it("a block either way keeps the chat closed, without saying why", () => {
    expect(decide({ blocked: true, otherIntro: "interested" })).toEqual({
      kind: "interest_saved",
      reason: "unavailable",
    });
  });

  it("a paused or deleted other person keeps the chat closed", () => {
    expect(decide({ otherAvailable: false, otherIntro: "interested" })).toEqual(
      { kind: "interest_saved", reason: "unavailable" },
    );
  });
});

describe("chooseOpener", () => {
  const p = (id: string, gender: Gender | null, at: number) => ({
    id,
    gender,
    decidedAtMs: at,
  });

  it("man-woman: the woman, whoever was first", () => {
    expect(chooseOpener(p("a", "man", 1), p("b", "woman", 2), true)).toBe("b");
    expect(chooseOpener(p("a", "woman", 5), p("b", "man", 2), true)).toBe("a");
  });

  it("without the rule (or for other pairs) the earlier one opens", () => {
    expect(chooseOpener(p("a", "man", 1), p("b", "woman", 2), false)).toBe("a");
    expect(chooseOpener(p("a", "woman", 3), p("b", "woman", 2), true)).toBe(
      "b",
    );
  });

  it("an exact tie goes to the smaller id", () => {
    expect(chooseOpener(p("b", "man", 1), p("a", "man", 1), true)).toBe("b");
    expect(chooseOpener(p("a", "man", 1), p("b", "man", 1), true)).toBe("a");
  });

  it("womanOpens=false turns the woman-first rule off for decideIntro too", () => {
    expect(
      decideIntro(input({ otherIntro: "interested" }), { womanOpens: false }),
    ).toEqual({ kind: "opened", opener: "other" });
    expect(
      decideIntro(
        input({
          viewerGender: "woman",
          otherGender: "man",
          otherIntro: "interested",
          viewerDecidedAt: 1000,
          otherDecidedAt: 2000,
        }),
        { womanOpens: false },
      ),
    ).toEqual({ kind: "opened", opener: "viewer" });
  });
});

describe("turning the database reply into an outcome", () => {
  it("maps each status", () => {
    expect(outcomeFromResult({ status: "passed" }, "me")).toEqual({
      kind: "passed",
    });
    expect(outcomeFromResult({ status: "viewer_at_cap" }, "me")).toEqual({
      kind: "viewer_at_cap",
    });
    expect(outcomeFromResult({ status: "already_open" }, "me")).toEqual({
      kind: "already_open",
    });
    expect(
      outcomeFromResult({ status: "opened", opener_id: "me" }, "me"),
    ).toEqual({ kind: "opened", opener: "viewer" });
    expect(
      outcomeFromResult({ status: "opened", opener_id: "them" }, "me"),
    ).toEqual({ kind: "opened", opener: "other" });
    expect(
      outcomeFromResult({ status: "interest_saved", reason: "waiting" }, "me"),
    ).toEqual({ kind: "interest_saved", reason: "waiting" });
  });

  it("returns null for anything unexpected", () => {
    expect(outcomeFromResult({ status: "weird" }, "me")).toBeNull();
    expect(
      outcomeFromResult({ status: "interest_saved", reason: "x" }, "me"),
    ).toBeNull();
    expect(outcomeFromResult({}, "me")).toBeNull();
  });

  it("maps the error codes and treats the rest as a failure", () => {
    expect(outcomeFromError("intro_not_found")).toEqual({
      kind: "rejected",
      reason: "not_found",
    });
    expect(outcomeFromError("error: intro_expired")).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    expect(outcomeFromError("already_decided")).toEqual({
      kind: "rejected",
      reason: "already_decided",
    });
    expect(outcomeFromError("viewer_unavailable")).toEqual({
      kind: "rejected",
      reason: "viewer_unavailable",
    });
    expect(outcomeFromError("connection reset")).toBeNull();
    expect(outcomeFromError(undefined)).toBeNull();
  });
});

describe("what the member is told", () => {
  const waiting = noticeFor({ kind: "interest_saved", reason: "waiting" }, 3);

  it("gives the same words for waiting, other at cap and unavailable", () => {
    expect(
      noticeFor({ kind: "interest_saved", reason: "other_at_cap" }, 3),
    ).toEqual(waiting);
    expect(
      noticeFor({ kind: "interest_saved", reason: "unavailable" }, 3),
    ).toEqual(waiting);
  });

  it("never claims anything about the other person's answer", () => {
    expect(waiting.text).not.toMatch(
      /passed|declined|not interested|rejected/i,
    );
  });

  it("explains the cap clearly and names the number", () => {
    const n = noticeFor({ kind: "viewer_at_cap" }, 3);
    expect(n.tone).toBe("warning");
    expect(n.text).toContain("3 chats");
    expect(n.text).toMatch(/Nothing was saved/);
    expect(noticeFor({ kind: "viewer_at_cap" }, 5).text).toContain("5 chats");
  });

  it("says who writes first when a chat opens", () => {
    expect(noticeFor({ kind: "opened", opener: "viewer" }, 3).text).toMatch(
      /you write first/,
    );
    expect(noticeFor({ kind: "opened", opener: "other" }, 3).text).toMatch(
      /they write first/,
    );
  });
});
