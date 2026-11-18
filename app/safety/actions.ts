"use server";

import { z } from "zod";
import {
  BLOCK_DONE_TEXT,
  REPORT_ALREADY_TEXT,
  REPORT_RECEIVED_TEXT,
} from "@/config/safety";
import { closeTemplateText } from "@/config/conversation";
import { retryAfterSlotsFreed } from "@/lib/conversation/after-close";
import { logEvent } from "@/lib/events";
import {
  blockUserInDb,
  endKeptChatInDb,
  reportUserInDb,
  safetyErrorText,
} from "@/lib/safety/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  blockSchema,
  endChatSchema,
  reportSchema,
} from "@/lib/validators/safety";

// Block, report and end-a-kept-chat. Each action is a public endpoint, so each
// checks who is signed in (from the session cookie, never from the request),
// the shape of the input, and then asks a database function to do the work.
// The database function also checks that the two people are linked (an intro
// or a chat), so these cannot be pointed at a stranger.
// They do not call revalidatePath on purpose: the card or chat the person is
// looking at would vanish and take the confirmation message with it. The
// screen refreshes itself when the person closes the message.

export type SafetyResult =
  { ok: true; message: string } | { ok: false; message: string };

async function sessionAndService() {
  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { service, userId: data.user.id };
}

const NOT_READY: SafetyResult = {
  ok: false,
  message: "Please log in again.",
};
const BAD_INPUT: SafetyResult = {
  ok: false,
  message: "That did not look right. Please try again.",
};

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------
export async function blockUserAction(
  input: z.input<typeof blockSchema>,
): Promise<SafetyResult> {
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  const session = await sessionAndService();
  if (!session) return NOT_READY;

  const result = await blockUserInDb(session.service, {
    blockerId: session.userId,
    targetId: parsed.data.targetId,
  });
  if (!result.ok) return { ok: false, message: safetyErrorText(result.code) };

  if (!result.value.already) await logEvent("user_blocked", session.userId);
  // The chat that just ended no longer counts to anyone's cap, so matches
  // that were waiting for a slot get another try.
  if (result.value.freed_user_ids.length > 0) {
    await retryAfterSlotsFreed(session.service, result.value.freed_user_ids);
  }
  return { ok: true, message: BLOCK_DONE_TEXT };
}

// ---------------------------------------------------------------------------
// Report (optionally with the recent messages attached, optionally block too)
// ---------------------------------------------------------------------------
export async function reportUserAction(
  input: z.input<typeof reportSchema>,
): Promise<SafetyResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  const session = await sessionAndService();
  if (!session) return NOT_READY;
  const { targetId, conversationId, reason, alsoBlock } = parsed.data;
  const details = parsed.data.details?.trim() || null;

  // Only a chat can be attached, so "attach" without a chat is ignored.
  const attach = Boolean(parsed.data.attach && conversationId);

  const result = await reportUserInDb(session.service, {
    reporterId: session.userId,
    targetId,
    conversationId: conversationId ?? null,
    reason,
    details,
    attach,
  });
  if (!result.ok) return { ok: false, message: safetyErrorText(result.code) };

  const already = result.value.status === "already_reported";
  if (!already) {
    // No names, no text: only the reason category.
    await logEvent("user_reported", session.userId, { reason, attach });
  }

  let message = already ? REPORT_ALREADY_TEXT : REPORT_RECEIVED_TEXT;
  if (alsoBlock) {
    // After the report, so the evidence copy was taken while the chat was live.
    const blocked = await blockUserInDb(session.service, {
      blockerId: session.userId,
      targetId,
    });
    if (blocked.ok) {
      if (!blocked.value.already) {
        await logEvent("user_blocked", session.userId);
      }
      if (blocked.value.freed_user_ids.length > 0) {
        await retryAfterSlotsFreed(
          session.service,
          blocked.value.freed_user_ids,
        );
      }
      message += " " + BLOCK_DONE_TEXT;
    } else {
      message += " We could not block them just now; you can try Block again.";
    }
  }
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// End a kept chat kindly
// ---------------------------------------------------------------------------
export async function endKeptChatAction(
  input: z.input<typeof endChatSchema>,
): Promise<SafetyResult> {
  const parsed = endChatSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  // The note is one of our own templates, looked up here on the server.
  const note = closeTemplateText(parsed.data.templateId);
  if (!note) return { ok: false, message: "Pick one of the notes." };
  const session = await sessionAndService();
  if (!session) return NOT_READY;

  const result = await endKeptChatInDb(session.service, {
    userId: session.userId,
    conversationId: parsed.data.conversationId,
    note,
  });
  if (!result.ok) return { ok: false, message: safetyErrorText(result.code) };

  await logEvent("chat_ended_after_keep", session.userId);
  await retryAfterSlotsFreed(session.service, [
    session.userId,
    result.value.other_id,
  ]);
  return {
    ok: true,
    message:
      "This chat has ended. They will see your kind note. Your chat slot is free again.",
  };
}
