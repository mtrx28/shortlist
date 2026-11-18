"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { closeTemplateText } from "@/config/conversation";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import { retryAfterSlotsFreed } from "@/lib/conversation/after-close";
import {
  demoControlsEnabled,
  demoGuard,
  shiftedTimes,
} from "@/lib/conversation/demo";
import {
  checkMessageBody,
  contactWarningFor,
  messageErrorText,
} from "@/lib/conversation/message";
import {
  recordDecisionInDb,
  sendMessageInDb,
} from "@/lib/conversation/service";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CONTACT_MESSAGES,
  type ContactKind,
} from "@/lib/validators/contact-info";

// Server actions for one chat. Each one is a public endpoint, so each checks:
// who is signed in (from the session cookie), the shape of the input, and
// then asks a database function to do the real work. The person's id always
// comes from the verified session, never from the request.

// ---------------------------------------------------------------------------
// Send a message
// ---------------------------------------------------------------------------
export type SendActionResult =
  | { ok: true; id: string; createdAt: string }
  | {
      ok: false;
      code: string;
      message: string;
      // set when the first message looks like it has contact details: the
      // screen asks "Are you sure?" and sends again with confirmContact
      needsConfirm?: ContactKind;
    };

const sendSchema = z.object({
  conversationId: z.uuid(),
  body: z.string().max(5000),
  confirmContact: z.boolean().optional(),
});

export async function sendMessageAction(
  input: z.input<typeof sendSchema>,
): Promise<SendActionResult> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "bad_input", message: messageErrorText("empty") };
  }
  const { conversationId, confirmContact } = parsed.data;

  const checked = checkMessageBody(parsed.data.body);
  if (!checked.ok) {
    return {
      ok: false,
      code: checked.error,
      message: messageErrorText(checked.error),
    };
  }

  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) {
    return {
      ok: false,
      code: "not_ready",
      message: "This server is not set up yet.",
    };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { ok: false, code: "signed_out", message: "Please log in again." };
  }
  const userId = data.user.id;

  // Is this the first message this person is sending in this chat? Read with
  // their own client, so a stranger just gets 0 and the database refuses later.
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_id", userId);
  const isFirst = (count ?? 0) === 0;

  // Soft warning: ask once, then send and flag it for moderation.
  const contact = contactWarningFor(checked.body, isFirst);
  if (contact && !confirmContact) {
    return {
      ok: false,
      code: "confirm_contact",
      message: `${CONTACT_MESSAGES[contact]} Keep early chats in the app until you know each other.`,
      needsConfirm: contact,
    };
  }

  const result = await sendMessageInDb(service, {
    senderId: userId,
    conversationId,
    body: checked.body,
    flagged: contact !== null,
  });
  if (!result) {
    return {
      ok: false,
      code: "failed",
      message: "We could not send that. Please try again.",
    };
  }
  if (!result.ok) {
    if (result.code === "rate_limited") {
      await logEvent("message_rate_limited", userId);
    }
    return {
      ok: false,
      code: result.code,
      message: messageErrorText(result.code),
    };
  }

  // Events carry no message text and no names: only what kind of thing happened.
  if (result.firstFromSender) {
    await logEvent(result.firstReply ? "first_reply" : "first_message", userId);
  }
  if (contact) await logEvent("message_flagged", userId, { kind: contact });

  return { ok: true, id: result.id, createdAt: result.createdAt };
}

// ---------------------------------------------------------------------------
// Keep or Close
// ---------------------------------------------------------------------------
export type DecideActionResult =
  | { ok: true; status: "kept" | "closed" | "waiting"; message: string }
  | { ok: false; code: string; message: string };

const decideSchema = z.object({
  conversationId: z.uuid(),
  decision: z.enum(["keep", "close"]),
  templateId: z.string().max(40).optional(),
});

const DECISION_ERRORS: Record<string, string> = {
  decision_not_open: "The decision opens on day 3, once you have both written.",
  window_ended: "The time for this chat is over.",
  not_open: "This chat has already ended.",
  not_participant: "We could not find that chat.",
  unavailable: "This chat is not available right now.",
};

export async function decideAction(
  input: z.input<typeof decideSchema>,
): Promise<DecideActionResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "bad_input",
      message: "That choice is not valid.",
    };
  }
  const { conversationId, decision } = parsed.data;

  // Closing needs one of our own kind notes; the text comes from config, never
  // from the request.
  let note: string | null = null;
  if (decision === "close") {
    note = closeTemplateText(parsed.data.templateId ?? "");
    if (!note) {
      return {
        ok: false,
        code: "bad_input",
        message: "Pick one of the notes.",
      };
    }
  }

  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) {
    return {
      ok: false,
      code: "not_ready",
      message: "This server is not set up yet.",
    };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { ok: false, code: "signed_out", message: "Please log in again." };
  }
  const userId = data.user.id;

  // Who is the other person? (Needed to free their slot too when closing.)
  const { data: snap } = await supabase.rpc("get_conversation", {
    p_conversation: conversationId,
  });
  const otherId = (snap as { other_id?: string } | null)?.other_id ?? null;

  const result = await recordDecisionInDb(service, {
    userId,
    conversationId,
    decision,
    note,
  });
  if (!result) {
    return {
      ok: false,
      code: "failed",
      message: "We could not save that. Please try again.",
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message:
        DECISION_ERRORS[result.code] ??
        "We could not save that. Please try again.",
    };
  }

  if (result.status === "kept") {
    await logEvent("chat_kept", userId);
  } else if (result.status === "closed") {
    await logEvent("chat_closed", userId, {
      template: parsed.data.templateId ?? "",
    });
    // The chat no longer counts to anyone's cap: matches that were waiting
    // for a free slot get another try.
    await retryAfterSlotsFreed(service, otherId ? [userId, otherId] : [userId]);
  }

  revalidatePath("/chat");
  revalidatePath("/shortlist");
  const message =
    result.status === "kept"
      ? "You both want to keep talking. This chat is now kept."
      : result.status === "closed"
        ? "You closed this chat kindly. They will see your note."
        : "Saved. We will tell you if you both choose to keep talking. We will not say what they chose otherwise.";
  return { ok: true, status: result.status, message };
}

// ---------------------------------------------------------------------------
// Demo controls: move a chat's clock forward
// ---------------------------------------------------------------------------
const demoSchema = z.object({
  conversationId: z.uuid(),
  step: z.enum(["day3", "almost_over", "expire"]),
});

export type DemoActionResult = { ok: boolean; message: string };

export async function demoFastForwardAction(
  input: z.input<typeof demoSchema>,
): Promise<DemoActionResult> {
  const parsed = demoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That step is not valid." };

  // Lock 1: the setting. Checked first so a production deployment answers the
  // same way to everyone and does no work.
  if (!demoControlsEnabled()) {
    return { ok: false, message: "Demo controls are switched off." };
  }

  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) return { ok: false, message: "Not set up." };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, message: "Please log in again." };
  const userId = data.user.id;

  // The chat, read as the signed-in person: a stranger gets nothing.
  const { data: snap } = await supabase.rpc("get_conversation", {
    p_conversation: parsed.data.conversationId,
  });
  const chat = snap as {
    other_id: string;
    status: string;
    opened_at: string;
    window_ends_at: string;
  } | null;
  if (!chat) return { ok: false, message: "We could not find that chat." };
  if (chat.status !== "open") {
    return { ok: false, message: "Only an open chat can be moved forward." };
  }

  // Locks 2 and 3: a demo account is involved, and the caller is in the chat.
  const demoAccounts: Record<string, boolean> = {};
  for (const id of [userId, chat.other_id]) {
    const { data: found } = await service.auth.admin.getUserById(id);
    demoAccounts[id] = found.user?.app_metadata?.demo === true;
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const guard = demoGuard({
    enabled: true,
    actorId: userId,
    actorIsAdmin: me?.role === "admin",
    userA: userId,
    userB: chat.other_id,
    demoAccounts,
  });
  if (!guard.ok) {
    return {
      ok: false,
      message: "Demo controls only work on chats with a demo account.",
    };
  }

  const times = shiftedTimes(
    parsed.data.step,
    new Date(),
    {
      openedAt: new Date(chat.opened_at),
      windowEndsAt: new Date(chat.window_ends_at),
    },
    SHORTLIST_CONFIG.windowHours,
  );
  const { error } = await service
    .from("conversations")
    .update({
      opened_at: times.openedAt.toISOString(),
      window_ends_at: times.windowEndsAt.toISOString(),
    })
    .eq("id", parsed.data.conversationId)
    .eq("status", "open");
  if (error) return { ok: false, message: "We could not move the clock." };

  await logEvent("demo_fast_forward", userId, { step: parsed.data.step });
  revalidatePath("/chat");
  return { ok: true, message: "Done. The chat clock was moved." };
}
