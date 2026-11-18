import { CONVERSATION_CONFIG } from "@/config/conversation";
import {
  findContactInfo,
  type ContactKind,
} from "@/lib/validators/contact-info";

// Rules for one message, in plain TypeScript. The server runs these before
// calling the database, and the database function send_message() checks the
// length, blank and control-character rules again, so a bug here cannot let
// a bad message through.

// Control characters except tab and newline. Removed, not rejected: they are
// almost always pasted junk, and a stray one should not block a message.
// (U+0000-0008, 000B, 000C, 000E-001F, 007F, plus zero-width and direction
// marks that can be used to hide text.)
const JUNK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠﻿]/g;

export function sanitizeMessageBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(JUNK, "")
    .replace(/[ \t]+\n/g, "\n") // trailing spaces on a line
    .replace(/\n{3,}/g, "\n\n") // at most one blank line in a row
    .trim();
}

export type BodyCheck =
  { ok: true; body: string } | { ok: false; error: "empty" | "too_long" };

export function checkMessageBody(
  raw: string,
  maxLength: number = CONVERSATION_CONFIG.messageMaxLength,
): BodyCheck {
  const body = sanitizeMessageBody(raw);
  if (body.length === 0) return { ok: false, error: "empty" };
  // Count characters the way Postgres char_length does (code points).
  if ([...body].length > maxLength) return { ok: false, error: "too_long" };
  return { ok: true, body };
}

// The soft warning for a first message. It is only a warning: the person can
// send anyway, and then the message is flagged for moderation (nothing is
// blocked and the text is never copied into events or logs).
export function contactWarningFor(
  body: string,
  isFirstMessageFromSender: boolean,
): ContactKind | null {
  if (!isFirstMessageFromSender) return null;
  return findContactInfo(body);
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------
// A person may send at most N messages in the last minute and M in the last
// hour, counted over all their chats. The database does the same count with
// "select count(*) ... where sender_id = me and created_at > now - interval",
// so no memory is needed on the server (serverless instances do not share
// any). This is the pure version of that rule, used by tests and the parity
// check.
export function isRateLimited(
  sentLastMinute: number,
  sentLastHour: number,
  perMinute: number = CONVERSATION_CONFIG.rateLimitPerMinute,
  perHour: number = CONVERSATION_CONFIG.rateLimitPerHour,
): boolean {
  return sentLastMinute >= perMinute || sentLastHour >= perHour;
}

export const MESSAGE_ERROR_TEXT: Record<string, string> = {
  empty: "Write something first.",
  too_long: `That message is too long. The limit is ${CONVERSATION_CONFIG.messageMaxLength} characters.`,
  rate_limited:
    "You are sending messages very quickly. Please wait a minute and try again.",
  wait_for_opener:
    "The other person writes first in this chat. You will see their message here.",
  wait_for_reply: "Let them reply first. You can write again once they answer.",
  window_ended:
    "The time for this chat is over, so it cannot take new messages.",
  not_open: "This chat has ended, so it cannot take new messages.",
  not_participant: "We could not find that chat.",
  unavailable: "This chat is not available right now.",
};

export function messageErrorText(code: string): string {
  return (
    MESSAGE_ERROR_TEXT[code] ?? "We could not send that. Please try again."
  );
}
