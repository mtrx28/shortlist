import type { SupabaseClient } from "@supabase/supabase-js";
import { CONVERSATION_CONFIG } from "@/config/conversation";

// Thin wrappers around the chat database functions. They need the
// service-role client (the functions are not callable by signed-in users), so
// the caller must pass the id of the VERIFIED session as the sender or
// decider, never an id taken from a form.

export type SendResult =
  | {
      ok: true;
      id: string;
      createdAt: string;
      firstFromSender: boolean;
      firstReply: boolean;
    }
  | { ok: false; code: string };

// The codes the functions raise (see the migration).
const KNOWN_CODES = [
  "body_empty",
  "body_too_long",
  "body_bad_chars",
  "conversation_not_found",
  "not_open",
  "unavailable",
  "window_ended",
  "wait_for_opener",
  "wait_for_reply",
  "rate_limited",
  "bad_decision",
  "bad_note",
  "decision_not_open",
] as const;

// Turns a database error message into one of the short codes, or null when it
// is something else (a real failure).
export function errorCode(message: string | undefined | null): string | null {
  if (!message) return null;
  // Match whole codes only: "decision_not_open" must not be read as "not_open".
  return (
    KNOWN_CODES.find((code) =>
      new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`).test(message),
    ) ?? null
  );
}

// The screens use a smaller set of names than the database.
export function publicCode(code: string): string {
  switch (code) {
    case "body_empty":
      return "empty";
    case "body_too_long":
      return "too_long";
    case "body_bad_chars":
      return "empty";
    case "conversation_not_found":
      return "not_participant";
    default:
      return code;
  }
}

export async function sendMessageInDb(
  service: SupabaseClient,
  args: {
    senderId: string;
    conversationId: string;
    body: string;
    flagged: boolean;
    now?: Date;
  },
): Promise<SendResult | null> {
  const { data, error } = await service.rpc("send_message", {
    p_sender: args.senderId,
    p_conversation: args.conversationId,
    p_body: args.body,
    p_flagged: args.flagged,
    p_now: (args.now ?? new Date()).toISOString(),
    p_max_length: CONVERSATION_CONFIG.messageMaxLength,
    p_max_before_reply: CONVERSATION_CONFIG.maxMessagesBeforeReply,
    p_per_minute: CONVERSATION_CONFIG.rateLimitPerMinute,
    p_per_hour: CONVERSATION_CONFIG.rateLimitPerHour,
  });
  if (error) {
    const code = errorCode(error.message);
    return code ? { ok: false, code: publicCode(code) } : null;
  }
  const raw = (data ?? {}) as {
    id?: string;
    created_at?: string;
    first_from_sender?: boolean;
    first_reply?: boolean;
  };
  if (!raw.id || !raw.created_at) return null;
  return {
    ok: true,
    id: raw.id,
    createdAt: raw.created_at,
    firstFromSender: raw.first_from_sender === true,
    firstReply: raw.first_reply === true,
  };
}

export type DecisionResult =
  | { ok: true; status: "kept" | "closed" | "waiting"; changed: boolean }
  | { ok: false; code: string };

export async function recordDecisionInDb(
  service: SupabaseClient,
  args: {
    userId: string;
    conversationId: string;
    decision: "keep" | "close";
    note: string | null;
    now?: Date;
  },
): Promise<DecisionResult | null> {
  const { data, error } = await service.rpc("record_decision", {
    p_user: args.userId,
    p_conversation: args.conversationId,
    p_decision: args.decision,
    p_note: args.note,
    p_now: (args.now ?? new Date()).toISOString(),
    p_decision_after_hours: CONVERSATION_CONFIG.decisionOpensAfterHours,
  });
  if (error) {
    const code = errorCode(error.message);
    return code ? { ok: false, code: publicCode(code) } : null;
  }
  const raw = (data ?? {}) as { status?: string; changed?: boolean };
  if (
    raw.status !== "kept" &&
    raw.status !== "closed" &&
    raw.status !== "waiting"
  ) {
    return null;
  }
  return { ok: true, status: raw.status, changed: raw.changed === true };
}

export type ExpireResult = {
  expired: number;
  noFirstMessage: number;
  noReply: number;
  noDecision: number;
  userIds: string[];
};

export async function expireInDb(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<ExpireResult | null> {
  const { data, error } = await service.rpc("expire_conversations", {
    p_now: now.toISOString(),
    p_batch: 500,
  });
  if (error || !data) return null;
  const raw = data as {
    expired?: number;
    no_first_message?: number;
    no_reply?: number;
    no_decision?: number;
    user_ids?: string[];
  };
  return {
    expired: raw.expired ?? 0,
    noFirstMessage: raw.no_first_message ?? 0,
    noReply: raw.no_reply ?? 0,
    noDecision: raw.no_decision ?? 0,
    userIds: raw.user_ids ?? [],
  };
}
