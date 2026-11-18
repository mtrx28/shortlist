import { CONVERSATION_CONFIG } from "@/config/conversation";
import {
  DEFAULT_RULES,
  decisionOpensAt,
  phaseOf,
  type ChatDecision,
  type Conv,
  type ConversationStatus,
  type Phase,
} from "@/lib/conversation/state";

// What a screen needs to know about one chat, decided in one place so the
// thread page and the list agree. Pure functions: the clock is passed in.

// What get_conversation() returns, seen from the signed-in person.
export type ConversationSnapshot = {
  id: string;
  other_id: string;
  opener_id: string;
  status: ConversationStatus;
  opened_at: string;
  window_ends_at: string;
  closed_reason: string | null;
  closed_by: string | null;
  my_decision: ChatDecision | null; // never the other person's
  i_sent: number;
  they_sent: number;
  unavailable: boolean;
  server_now: string;
};

// The pure rules work with two named people; "A" is me and "B" is them. Their
// decision is not known to the screens (and does not need to be).
export function toConv(snap: ConversationSnapshot, me: string): Conv {
  return {
    status: snap.status,
    userA: me,
    userB: snap.other_id,
    openerId: snap.opener_id,
    openedAt: new Date(snap.opened_at),
    windowEndsAt: new Date(snap.window_ends_at),
    sentA: snap.i_sent,
    sentB: snap.they_sent,
    aDecision: snap.my_decision,
    bDecision: null,
    closedReason: snap.closed_reason,
    closedBy: snap.closed_by,
  };
}

const HOUR = 3600 * 1000;

export type ThreadView = {
  phase: Phase;
  iAmOpener: boolean;
  canCompose: boolean;
  // Why the composer is off (shown in its place), or null.
  composeOffReason: string | null;
  // The reminder for the person who owes the first message or reply.
  nudge: { hoursLeft: number } | null;
  showDecision: boolean;
  myDecision: ChatDecision | null;
  decisionOpensAt: Date;
  windowEndsAt: Date;
  // Open and still counting down to the window end.
  showWindowCountdown: boolean;
  readOnly: boolean;
};

export function threadView(
  snap: ConversationSnapshot,
  me: string,
  now: Date,
): ThreadView {
  const conv = toConv(snap, me);
  const phase = phaseOf(conv, now, DEFAULT_RULES);
  const iAmOpener = snap.opener_id === me;
  const opensAt = decisionOpensAt(conv, DEFAULT_RULES);

  let canCompose = false;
  let composeOffReason: string | null = null;
  switch (phase) {
    case "awaiting_opener":
      canCompose = iAmOpener;
      if (!iAmOpener) {
        composeOffReason =
          "They write first in this chat. Their message will appear here.";
      }
      break;
    case "awaiting_reply":
      if (iAmOpener) {
        canCompose = snap.i_sent < DEFAULT_RULES.maxMessagesBeforeReply;
        if (!canCompose) {
          composeOffReason =
            "Let them reply first. You can write again once they answer.";
        }
      } else {
        canCompose = true;
      }
      break;
    case "chatting":
    case "deciding":
    case "kept":
      canCompose = true;
      break;
    default:
      composeOffReason =
        phase === "timed_out"
          ? "The time for this chat is over, so it cannot take new messages."
          : "This chat has ended, so it cannot take new messages.";
  }
  if (snap.unavailable && canCompose) {
    canCompose = false;
    composeOffReason = "This chat is not available right now.";
  }

  // The nudge: the person who owes the first message (the opener) or the
  // first reply (the other person) once the chat is nudgeAfterHours old.
  const owes =
    (phase === "awaiting_opener" && iAmOpener) ||
    (phase === "awaiting_reply" && !iAmOpener);
  const nudgeAt =
    conv.openedAt.getTime() + CONVERSATION_CONFIG.nudgeAfterHours * HOUR;
  const nudge =
    owes && now.getTime() >= nudgeAt
      ? {
          hoursLeft: Math.max(
            0,
            Math.ceil((conv.windowEndsAt.getTime() - now.getTime()) / HOUR),
          ),
        }
      : null;

  return {
    phase,
    iAmOpener,
    canCompose,
    composeOffReason,
    nudge,
    showDecision: phase === "deciding",
    myDecision: snap.my_decision,
    decisionOpensAt: opensAt,
    windowEndsAt: conv.windowEndsAt,
    showWindowCountdown:
      phase === "awaiting_opener" ||
      phase === "awaiting_reply" ||
      phase === "chatting" ||
      phase === "deciding",
    readOnly:
      phase === "closed" || phase === "expired" || phase === "timed_out",
  };
}

// ---------------------------------------------------------------------------
// The list: a short label and a tone for each chat.
// ---------------------------------------------------------------------------
export type ListBadge = {
  label: string;
  tone: "action" | "waiting" | "calm" | "ended";
};

export function listBadge(conv: Conv, me: string, now: Date): ListBadge {
  const phase = phaseOf(conv, now, DEFAULT_RULES);
  const iAmOpener = conv.openerId === me;
  switch (phase) {
    case "awaiting_opener":
      return iAmOpener
        ? { label: "Your turn: say hello", tone: "action" }
        : { label: "Waiting for them to write", tone: "waiting" };
    case "awaiting_reply":
      return iAmOpener
        ? { label: "Waiting for a reply", tone: "waiting" }
        : { label: "Your turn: reply", tone: "action" };
    case "chatting":
      return { label: "Chatting", tone: "calm" };
    case "deciding":
      return { label: "Time to decide", tone: "action" };
    case "kept":
      return { label: "Kept", tone: "calm" };
    case "closed":
      return { label: "Closed kindly", tone: "ended" };
    case "expired":
    case "timed_out":
      return { label: "Time ran out", tone: "ended" };
  }
}

// A one-line preview, cut at a word boundary where possible.
export function previewText(body: string | null, max = 70): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + "...";
}
