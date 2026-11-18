import { describe, expect, it } from "vitest";
import { CONVERSATION_CONFIG } from "@/config/conversation";
import {
  checkMessageBody,
  contactWarningFor,
  isRateLimited,
  messageErrorText,
  sanitizeMessageBody,
} from "@/lib/conversation/message";
import { errorCode, publicCode } from "@/lib/conversation/service";

describe("sanitizeMessageBody", () => {
  it.each([
    ["  hello  ", "hello"],
    ["a\r\nb", "a\nb"],
    ["a\rb", "a\nb"],
    ["bell\u0007here", "bellhere"],
    ["null\u0000byte", "nullbyte"],
    ["escape\u001b[0m", "escape[0m"],
    ["zero​width", "zerowidth"],
    ["flip‮text", "fliptext"],
    ["tab\there", "tab\there"],
    ["line one\n\n\n\n\nline two", "line one\n\nline two"],
    ["trailing   \nspace", "trailing\nspace"],
    ["emoji \u{1F600} stays", "emoji \u{1F600} stays"],
    ["नमस्ते", "नमस्ते"],
  ])("%j", (input, output) => {
    expect(sanitizeMessageBody(input)).toBe(output);
  });
});

describe("checkMessageBody", () => {
  it("accepts a normal message and returns the cleaned text", () => {
    expect(checkMessageBody("  Hi there!  ")).toEqual({
      ok: true,
      body: "Hi there!",
    });
  });

  it.each(["", "   ", "\n\n\t", "​​", "\u0007"])(
    "rejects empty %j",
    (input) => {
      expect(checkMessageBody(input)).toEqual({ ok: false, error: "empty" });
    },
  );

  it("accepts exactly the limit and rejects one more", () => {
    const max = CONVERSATION_CONFIG.messageMaxLength;
    expect(checkMessageBody("x".repeat(max)).ok).toBe(true);
    expect(checkMessageBody("x".repeat(max + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("counts an emoji as one character, like the database does", () => {
    const max = CONVERSATION_CONFIG.messageMaxLength;
    expect(checkMessageBody("\u{1F600}".repeat(max)).ok).toBe(true);
    expect(checkMessageBody("\u{1F600}".repeat(max + 1)).ok).toBe(false);
  });
});

describe("first-message contact warning", () => {
  it.each([
    ["call me on 98765 43210", "phone"],
    ["my number is +91 98765-43210", "phone"],
    ["https://instagram.com/me", "link"],
    ["find me at www.example.in", "link"],
    ["write to me at me@example.com", "email"],
    ["I am @rohan_codes there", "handle"],
  ])("warns about %j", (text, kind) => {
    expect(contactWarningFor(text, true)).toBe(kind);
  });

  it.each([
    "Hi! Loved your answer about slow Sundays.",
    "I have been to 3 treks in 2024",
    "Born in 1998, you?",
  ])("does not warn about %j", (text) => {
    expect(contactWarningFor(text, true)).toBeNull();
  });

  it("only checks the first message from that person", () => {
    expect(contactWarningFor("call me on 98765 43210", false)).toBeNull();
  });
});

describe("isRateLimited", () => {
  it.each([
    [0, 0, false],
    [7, 7, false],
    [8, 8, true],
    [3, 120, true],
    [3, 119, false],
    [100, 100, true],
  ])("minute %i, hour %i -> %s", (m, h, limited) => {
    expect(isRateLimited(m, h)).toBe(limited);
  });

  it("uses the limits it is given", () => {
    expect(isRateLimited(2, 2, 3, 10)).toBe(false);
    expect(isRateLimited(3, 3, 3, 10)).toBe(true);
    expect(isRateLimited(1, 10, 3, 10)).toBe(true);
  });
});

describe("error texts and codes", () => {
  it("has a friendly text for each refusal", () => {
    for (const code of [
      "empty",
      "too_long",
      "rate_limited",
      "wait_for_opener",
      "wait_for_reply",
      "window_ended",
      "not_open",
      "not_participant",
      "unavailable",
    ]) {
      expect(messageErrorText(code).length).toBeGreaterThan(10);
    }
    expect(messageErrorText("something_new")).toMatch(/try again/i);
  });

  it("reads database errors, keeping similar codes apart", () => {
    expect(errorCode("rate_limited")).toBe("rate_limited");
    expect(errorCode("decision_not_open")).toBe("decision_not_open");
    expect(errorCode("not_open")).toBe("not_open");
    expect(errorCode("Error: wait_for_reply (P0001)")).toBe("wait_for_reply");
    expect(errorCode("connection reset")).toBeNull();
    expect(errorCode(undefined)).toBeNull();
    expect(errorCode(null)).toBeNull();
  });

  it("turns database codes into screen codes", () => {
    expect(publicCode("body_empty")).toBe("empty");
    expect(publicCode("body_too_long")).toBe("too_long");
    expect(publicCode("conversation_not_found")).toBe("not_participant");
    expect(publicCode("rate_limited")).toBe("rate_limited");
  });
});
