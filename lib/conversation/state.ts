import { CONVERSATION_CONFIG } from "@/config/conversation";

// The life of a chat, as one pure function. Nothing here touches the database
// or the clock: "now" is always passed in, so every case is easy to test.
// The database functions send_message(), record_decision() and
// expire_conversations() (supabase/migrations/..._conversations.sql) follow
// the same rules in the same order inside one transaction; a test runs the
// same cases through both so they cannot drift apart.
//
// My reading of the rules (the conversation columns come from the first
// migration; this is what I decided they mean):
//
//  1. A chat opens with status "open" and a reply window (window_ends_at, 72h).
//  2. The opener writes first (the woman in a man-woman pair, see the
//     shortlist rules). The other person cannot write until the opener has.
//     The opener may send a few messages before the first reply, then has to
//     wait.
//  3. Once BOTH have written at least once the chat is "chatting". The
//     decision opens at "day 3" = decisionOpensAfterHours (48h) after the chat
//     opened. From then until the window ends each person records Keep or
//     Close.
//       - Both Keep      -> status "kept". The chat lasts and counts to the cap.
//       - Either Closes  -> status "closed" at once, with a kind note for the
//                           other person. Close is final.
//       - Only one person has decided Keep and the other never does -> when
//         the window ends the chat is "expired" (one Keep alone does not keep
//         it). Keep can still be changed to Close until the other person
//         decides.
//  4. When the window ends with no first message, no first reply or no
//     decisions, the chat becomes "expired".
//  5. Every time a chat leaves "open" (kept, closed or expired) the reply
//     rate of the people involved is updated once (see replyRateDeltas).
//  6. Messages are allowed while "open" (window not over) and "kept". Never in
//     closed or expired chats.

export type ConversationStatus =
  "open" | "kept" | "closed" | "expired" | "blocked";
export type ChatDecision = "keep" | "close";

export type Conv = {
  status: ConversationStatus;
  userA: string;
  userB: string;
  openerId: string;
  openedAt: Date;
  windowEndsAt: Date;
  // How many messages each person has sent in this chat.
  sentA: number;
  sentB: number;
  aDecision: ChatDecision | null;
  bDecision: ChatDecision | null;
  closedReason: string | null;
  closedBy: string | null;
};

export type ConvEvent =
  | { type: "message"; from: string }
  | { type: "decide"; by: string; decision: string; note?: string | null }
  | { type: "tick" }; // the expiry job looking at this chat

export type ConvError =
  | "not_participant" // also used for "no such chat"
  | "not_open" // the chat is closed, expired or blocked
  | "window_ended" // the time is up (the expiry job has not run yet)
  | "wait_for_opener" // the other person has to write first
  | "wait_for_reply" // the opener has used up the messages before a reply
  | "decision_not_open" // not both written yet, or day 3 has not started
  | "bad_decision"
  | "unavailable"; // blocked, suspended or deleted

export type Transition =
  | {
      ok: true;
      conv: Conv;
      changed: boolean;
      // true when this event moved the chat out of "open" (reply rates move)
      ended: boolean;
    }
  | { ok: false; error: ConvError };

export type Rules = {
  decisionOpensAfterHours: number;
  maxMessagesBeforeReply: number;
};

export const DEFAULT_RULES: Rules = {
  decisionOpensAfterHours: CONVERSATION_CONFIG.decisionOpensAfterHours,
  maxMessagesBeforeReply: CONVERSATION_CONFIG.maxMessagesBeforeReply,
};

// Texts stored in closed_reason when time runs out. They are internal: the
// screens show a neutral sentence and do not point at either person.
export const EXPIRY_REASONS = {
  noFirstMessage: "No first message within the window.",
  noReply: "No reply within the window.",
  noDecision: "No decision within the window.",
} as const;

const HOUR = 3600 * 1000;

export function otherPerson(conv: Conv, me: string): string {
  return conv.userA === me ? conv.userB : conv.userA;
}

export function isParticipant(conv: Conv, id: string): boolean {
  return id === conv.userA || id === conv.userB;
}

export function sentBy(conv: Conv, id: string): number {
  return id === conv.userA ? conv.sentA : id === conv.userB ? conv.sentB : 0;
}

export function decisionOf(conv: Conv, id: string): ChatDecision | null {
  return id === conv.userA
    ? conv.aDecision
    : id === conv.userB
      ? conv.bDecision
      : null;
}

export function decisionOpensAt(conv: Conv, rules: Rules = DEFAULT_RULES) {
  return new Date(
    conv.openedAt.getTime() + rules.decisionOpensAfterHours * HOUR,
  );
}

export function windowEnded(conv: Conv, now: Date): boolean {
  return now.getTime() >= conv.windowEndsAt.getTime();
}

// Where an open chat is right now.
export type Phase =
  | "awaiting_opener" // nobody has written; the opener owes the first message
  | "awaiting_reply" // the opener wrote; the other person owes a reply
  | "chatting" // both wrote; the decision has not opened yet
  | "deciding" // both wrote and day 3 has started
  | "timed_out" // open, but the window is over (waiting for the expiry job)
  | "kept"
  | "closed"
  | "expired";

export function phaseOf(
  conv: Conv,
  now: Date,
  rules: Rules = DEFAULT_RULES,
): Phase {
  if (conv.status === "kept") return "kept";
  if (conv.status === "closed" || conv.status === "blocked") return "closed";
  if (conv.status === "expired") return "expired";
  if (windowEnded(conv, now)) return "timed_out";
  const openerSent = sentBy(conv, conv.openerId);
  const otherSent = sentBy(conv, otherPerson(conv, conv.openerId));
  if (openerSent === 0) return "awaiting_opener";
  if (otherSent === 0) return "awaiting_reply";
  if (now.getTime() >= decisionOpensAt(conv, rules).getTime()) {
    return "deciding";
  }
  return "chatting";
}

function fail(error: ConvError): Transition {
  return { ok: false, error };
}

function unchanged(conv: Conv): Transition {
  return { ok: true, conv, changed: false, ended: false };
}

// Why a chat that ran out of time ended, for closed_reason.
export function expiryReason(conv: Conv): string {
  const openerSent = sentBy(conv, conv.openerId);
  const otherSent = sentBy(conv, otherPerson(conv, conv.openerId));
  if (openerSent === 0) return EXPIRY_REASONS.noFirstMessage;
  if (otherSent === 0) return EXPIRY_REASONS.noReply;
  return EXPIRY_REASONS.noDecision;
}

export function nextState(
  conv: Conv,
  event: ConvEvent,
  now: Date,
  opts: { unavailable?: boolean; rules?: Rules } = {},
): Transition {
  const rules = opts.rules ?? DEFAULT_RULES;

  // ---- the expiry job looks at the chat ----
  if (event.type === "tick") {
    if (conv.status !== "open" || !windowEnded(conv, now)) {
      return unchanged(conv);
    }
    return {
      ok: true,
      changed: true,
      ended: true,
      conv: { ...conv, status: "expired", closedReason: expiryReason(conv) },
    };
  }

  // ---- a message ----
  if (event.type === "message") {
    const from = event.from;
    if (!isParticipant(conv, from)) return fail("not_participant");
    if (conv.status !== "open" && conv.status !== "kept") {
      return fail("not_open");
    }
    if (opts.unavailable) return fail("unavailable");
    if (conv.status === "open") {
      if (windowEnded(conv, now)) return fail("window_ended");
      const openerSent = sentBy(conv, conv.openerId);
      const otherSent = sentBy(conv, otherPerson(conv, conv.openerId));
      if (from !== conv.openerId && openerSent === 0) {
        return fail("wait_for_opener");
      }
      if (
        from === conv.openerId &&
        otherSent === 0 &&
        openerSent >= rules.maxMessagesBeforeReply
      ) {
        return fail("wait_for_reply");
      }
    }
    const next = { ...conv };
    if (from === conv.userA) next.sentA += 1;
    else next.sentB += 1;
    return { ok: true, conv: next, changed: true, ended: false };
  }

  // ---- a Keep or Close ----
  if (event.decision !== "keep" && event.decision !== "close") {
    return fail("bad_decision");
  }
  const decision: ChatDecision = event.decision;
  const by = event.by;
  if (!isParticipant(conv, by)) return fail("not_participant");
  if (conv.status !== "open") return fail("not_open");
  if (opts.unavailable) return fail("unavailable");
  if (windowEnded(conv, now)) return fail("window_ended");
  if (phaseOf(conv, now, rules) !== "deciding") {
    return fail("decision_not_open");
  }

  const mine = decisionOf(conv, by);
  const theirs = decisionOf(conv, otherPerson(conv, by));
  const setMine = (c: Conv, d: ChatDecision): Conv =>
    by === c.userA ? { ...c, aDecision: d } : { ...c, bDecision: d };

  if (decision === "close") {
    // Close is final and ends the chat straight away.
    return {
      ok: true,
      changed: true,
      ended: true,
      conv: {
        ...setMine(conv, "close"),
        status: "closed",
        closedBy: by,
        closedReason: event.note ?? null,
      },
    };
  }

  // Keep. Saying it twice changes nothing.
  if (mine === "keep") return unchanged(conv);
  const withMine = setMine(conv, "keep");
  if (theirs === "keep") {
    return {
      ok: true,
      changed: true,
      ended: true,
      conv: { ...withMine, status: "kept" },
    };
  }
  return { ok: true, changed: true, ended: false, conv: withMine };
}

// ---------------------------------------------------------------------------
// Reply rate
// ---------------------------------------------------------------------------
// reply_rate_num / reply_rate_den on the profile. Whenever a chat leaves
// "open", each person who OWED a message gets den + 1, and num + 1 if they
// did send one:
//   * the opener always owes the first message;
//   * the other person owes a reply only if the opener actually wrote.
// So someone who opened and never wrote counts against them, and someone who
// was never written to is not blamed. Deciding Keep or Close is not part of
// the reply rate: they did reply.
export type ReplyRateDelta = { userId: string; num: number; den: number };

export function replyRateDeltas(conv: Conv): ReplyRateDelta[] {
  const other = otherPerson(conv, conv.openerId);
  const openerSent = sentBy(conv, conv.openerId) > 0;
  const otherSent = sentBy(conv, other) > 0;
  const deltas: ReplyRateDelta[] = [
    { userId: conv.openerId, num: openerSent ? 1 : 0, den: 1 },
  ];
  if (openerSent) {
    deltas.push({ userId: other, num: otherSent ? 1 : 0, den: 1 });
  }
  return deltas;
}
