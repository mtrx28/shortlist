import { describe, expect, it } from "vitest";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import { capStatusText, chatCap, isAtCap, isPlus } from "@/lib/shortlist/caps";
import { cleanNote, validateIntroNote } from "@/lib/shortlist/note";
import {
  formatTimeLeft,
  introExpiresAt,
  isIntroExpired,
  nextDropAt,
} from "@/lib/shortlist/time";
import { buildShortlistView } from "@/lib/shortlist/view";
import { findContactInfo } from "@/lib/validators/contact-info";

describe("note validator", () => {
  it("treats empty and missing notes as no note", () => {
    expect(validateIntroNote(undefined)).toEqual({ ok: true, note: null });
    expect(validateIntroNote(null)).toEqual({ ok: true, note: null });
    expect(validateIntroNote("")).toEqual({ ok: true, note: null });
    expect(validateIntroNote("   \n\t ")).toEqual({ ok: true, note: null });
  });

  it("keeps a normal note and tidies spaces", () => {
    expect(validateIntroNote("  Early treks sound   great!  ")).toEqual({
      ok: true,
      note: "Early treks sound great!",
    });
  });

  it("strips control and invisible characters", () => {
    expect(cleanNote("hi\u0000 there​!\nbye\ttab")).toBe("hi there ! bye tab");
    expect(cleanNote("a‮bc")).toBe("a bc");
  });

  it("allows exactly the maximum length and refuses one more", () => {
    const max = SHORTLIST_CONFIG.noteMaxLength;
    expect(validateIntroNote("a".repeat(max))).toEqual({
      ok: true,
      note: "a".repeat(max),
    });
    const tooLong = validateIntroNote("a".repeat(max + 1));
    expect(tooLong.ok).toBe(false);
  });

  it("measures length after cleaning, not before", () => {
    const padded = " ".repeat(500) + "hello" + " ".repeat(500);
    expect(validateIntroNote(padded)).toEqual({ ok: true, note: "hello" });
  });

  it("refuses non-strings", () => {
    expect(validateIntroNote(42).ok).toBe(false);
    expect(validateIntroNote({}).ok).toBe(false);
  });

  it.each([
    "check https://example.com/me",
    "my site www.example.com",
    "find me on insta.com/me",
    "mail me at someone@example.com",
    "call 98765 43210",
    "call +91-98765-43210",
    "whatsapp (080) 2345 6789",
    "ping me @coolhandle",
  ])("refuses contact details: %s", (text) => {
    const r = validateIntroNote(text);
    expect(r.ok).toBe(false);
  });

  it.each([
    "I loved your answer about slow Sundays.",
    "Both from the 2021 batch, both in Pune!",
    "Filter coffee or chai? Mine is chai, 5 days a week.",
    "We could talk about trek no. 3 and trek 4.",
  ])("accepts an ordinary note: %s", (text) => {
    expect(validateIntroNote(text).ok).toBe(true);
  });

  it("names what was found", () => {
    expect(findContactInfo("a@b.co")).toBe("email");
    expect(findContactInfo("https://x.y")).toBe("link");
    expect(findContactInfo("9876543210")).toBe("phone");
    expect(findContactInfo("@someone")).toBe("handle");
    expect(findContactInfo("plain words")).toBeNull();
  });
});

describe("expiry and the weekly clock", () => {
  // Week of Monday 16 Nov 2026. The drop for the next week runs on Sunday
  // 22 Nov at 14:30 UTC (20:00 India time).
  it("an intro lasts until the next Sunday drop time", () => {
    expect(introExpiresAt("2026-11-16").toISOString()).toBe(
      "2026-11-22T14:30:00.000Z",
    );
  });

  it("is not expired just before, and expired at and after", () => {
    expect(isIntroExpired("2026-11-16", new Date("2026-11-22T14:29:59Z"))).toBe(
      false,
    );
    expect(isIntroExpired("2026-11-16", new Date("2026-11-22T14:30:00Z"))).toBe(
      true,
    );
    expect(isIntroExpired("2026-11-16", new Date("2026-11-25T00:00:00Z"))).toBe(
      true,
    );
  });

  it("is not expired the moment the week starts", () => {
    expect(isIntroExpired("2026-11-16", new Date("2026-11-16T00:00:00Z"))).toBe(
      false,
    );
  });

  it("next drop: later this week, or a week on once Sunday's time has passed", () => {
    // Wednesday 18 Nov -> Sunday 22 Nov 14:30 UTC
    expect(nextDropAt(new Date("2026-11-18T10:00:00Z")).toISOString()).toBe(
      "2026-11-22T14:30:00.000Z",
    );
    // Sunday before the drop
    expect(nextDropAt(new Date("2026-11-22T14:00:00Z")).toISOString()).toBe(
      "2026-11-22T14:30:00.000Z",
    );
    // Exactly at the drop time: the next one is a week later
    expect(nextDropAt(new Date("2026-11-22T14:30:00Z")).toISOString()).toBe(
      "2026-11-29T14:30:00.000Z",
    );
    // Monday right after
    expect(nextDropAt(new Date("2026-11-23T00:00:00Z")).toISOString()).toBe(
      "2026-11-29T14:30:00.000Z",
    );
  });

  it("every intro expires exactly when a drop goes out", () => {
    // The drop for week W goes out on the Sunday before W; it ends at the
    // time of the next Sunday drop.
    const expires = introExpiresAt("2026-11-16");
    expect(nextDropAt(new Date(expires.getTime() - 1)).getTime()).toBe(
      expires.getTime(),
    );
  });
});

describe("time left", () => {
  const at = (iso: string) => new Date(iso);
  const now = at("2026-11-18T10:00:00Z");

  it.each([
    ["2026-11-21T14:30:00Z", "3 days 4 hours"],
    ["2026-11-19T10:00:00Z", "1 day"],
    ["2026-11-18T15:20:00Z", "5 hours 20 min"],
    ["2026-11-18T11:00:00Z", "1 hour"],
    ["2026-11-18T10:12:00Z", "12 min"],
    ["2026-11-18T10:00:30Z", "under a minute"],
    ["2026-11-18T10:00:00Z", "now"],
    ["2026-11-17T10:00:00Z", "now"],
  ])("%s -> %s", (target, expected) => {
    expect(formatTimeLeft(at(target), now)).toBe(expected);
  });
});

describe("chat cap", () => {
  const now = new Date("2026-11-18T10:00:00Z");

  it("free members get 3, Plus members 5", () => {
    expect(chatCap(null, now)).toBe(3);
    expect(chatCap("2026-12-01T00:00:00Z", now)).toBe(5);
  });

  it("Plus that has run out counts as free", () => {
    expect(chatCap("2026-11-01T00:00:00Z", now)).toBe(3);
    expect(isPlus("2026-11-18T10:00:00Z", now)).toBe(false);
  });

  it("at the cap means equal or more", () => {
    expect(isAtCap(2, 3)).toBe(false);
    expect(isAtCap(3, 3)).toBe(true);
    expect(isAtCap(4, 3)).toBe(true);
  });

  it("writes the status line", () => {
    expect(capStatusText(2, 3)).toBe("2 of 3 chats open");
  });
});

describe("which screen to show", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const week = "2026-11-16";

  it("paused wins over everything", () => {
    expect(
      buildShortlistView({
        paused: true,
        latestWeek: week,
        statuses: ["new"],
        now,
      }).screen,
    ).toBe("paused");
  });

  it("no drop has run yet", () => {
    expect(
      buildShortlistView({
        paused: false,
        latestWeek: null,
        statuses: [],
        now,
      }).screen,
    ).toBe("no_drop");
  });

  it("the latest drop is over and the next has not run", () => {
    expect(
      buildShortlistView({
        paused: false,
        latestWeek: week,
        statuses: ["new"],
        now: new Date("2026-11-22T15:00:00Z"),
      }).screen,
    ).toBe("between_drops");
  });

  it("a thin pool: a drop ran but this member got nobody", () => {
    expect(
      buildShortlistView({
        paused: false,
        latestWeek: week,
        statuses: [],
        now,
      }).screen,
    ).toBe("no_intros");
  });

  it("everything answered", () => {
    expect(
      buildShortlistView({
        paused: false,
        latestWeek: week,
        statuses: ["passed", "interested"],
        now,
      }),
    ).toMatchObject({ screen: "all_decided", left: 0, total: 2 });
  });

  it("intros left to answer, counted", () => {
    expect(
      buildShortlistView({
        paused: false,
        latestWeek: week,
        statuses: ["new", "passed", "new"],
        now,
      }),
    ).toMatchObject({ screen: "intros", left: 2, total: 3 });
  });
});
