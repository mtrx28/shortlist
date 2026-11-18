import type { DecideOutcome } from "@/lib/shortlist/decide";
import { SHORTLIST_CONFIG } from "@/config/shortlist";

// The words shown after someone answers an intro. They are written so that
// they never reveal what the other person decided: "Interested" always gets
// the same reply unless a chat really opens (and then both are interested, so
// nothing secret is given away). A pass is never announced to anyone.

export type Notice = { tone: "info" | "success" | "warning"; text: string };

export function noticeFor(outcome: DecideOutcome, chatCap: number): Notice {
  switch (outcome.kind) {
    case "passed":
      return {
        tone: "info",
        text: "Passed. They will not be told, and they will not see you in a chat.",
      };
    case "interest_saved":
      // Same words for "waiting", "other at cap" and "unavailable" on purpose.
      return {
        tone: "success",
        text: "Interest saved. If it is mutual, a chat opens and you will see it under Chats. We will not tell you what the other person decided otherwise.",
      };
    case "opened":
      return {
        tone: "success",
        text:
          outcome.opener === "viewer"
            ? `It is mutual. A chat is open under Chats, and you write first. It stays open for ${SHORTLIST_CONFIG.windowHours} hours.`
            : `It is mutual. A chat is open under Chats, and they write first. It stays open for ${SHORTLIST_CONFIG.windowHours} hours.`,
      };
    case "already_open":
      return {
        tone: "info",
        text: "You already have a chat with this person. Find it under Chats.",
      };
    case "viewer_at_cap":
      return {
        tone: "warning",
        text: `You already have ${chatCap} chats open, which is the most you can have at once. Nothing was saved. Close or finish one of your chats, then come back to answer this intro (it stays here until the next drop). You can still pass.`,
      };
    case "rejected":
      switch (outcome.reason) {
        case "expired":
          return {
            tone: "warning",
            text: "This intro has expired. A new drop arrives every Sunday evening.",
          };
        case "already_decided":
          return {
            tone: "warning",
            text: "You already answered this intro, and an answer cannot be changed.",
          };
        case "viewer_unavailable":
          return {
            tone: "warning",
            text: "Your profile is paused or not finished, so you cannot answer intros right now.",
          };
        default:
          return { tone: "warning", text: "We could not find that intro." };
      }
  }
}
