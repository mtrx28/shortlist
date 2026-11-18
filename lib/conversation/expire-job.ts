import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/events";
import { retryAfterSlotsFreed } from "@/lib/conversation/after-close";
import { expireInDb } from "@/lib/conversation/service";

// The hourly job: end chats whose time is up, then give matches that were
// waiting for a free slot another try. Safe to run twice (the database
// function only touches chats that are still open). Returns counts only.

export type ExpireJobOutcome = {
  expired: number;
  noFirstMessage: number;
  noReply: number;
  noDecision: number;
  opened: number;
};

export async function runExpireJob(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<ExpireJobOutcome> {
  const result = await expireInDb(service, now);
  if (!result) throw new Error("expire_conversations failed");

  let opened = 0;
  if (result.expired > 0) {
    opened = await retryAfterSlotsFreed(service, result.userIds, now);
  }

  const outcome: ExpireJobOutcome = {
    expired: result.expired,
    noFirstMessage: result.noFirstMessage,
    noReply: result.noReply,
    noDecision: result.noDecision,
    opened,
  };
  if (result.expired > 0) {
    // Counts only: no names, no message text.
    await logEvent("chats_expired", null, { ...outcome });
  }
  return outcome;
}
