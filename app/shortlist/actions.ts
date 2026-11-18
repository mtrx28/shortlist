"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SECOND_LOOK } from "@/config/plans";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { chatCap } from "@/lib/shortlist/caps";
import { noticeFor } from "@/lib/shortlist/messages";
import { validateIntroNote } from "@/lib/shortlist/note";
import { decideIntroInDb } from "@/lib/shortlist/service";
import { toFormState, type FormState } from "@/lib/validators/auth";

// Answering an intro (Interested or Pass). A server action is a public
// endpoint, so everything is checked here: who is signed in, the input shape,
// the note. The decision itself is made inside the database by decide_intro(),
// which the browser cannot call. The viewer id comes from the verified
// session, never from the form.

const answerSchema = z.object({
  introId: z.uuid("That intro is not valid."),
  decision: z.enum(["interested", "passed"]),
  note: z.string().max(2000).optional(),
});

export async function answerIntroAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = answerSchema.safeParse({
    introId: form.get("introId"),
    decision: form.get("decision"),
    note: form.get("note") ?? undefined,
  });
  if (!parsed.success) return toFormState(parsed.error);
  const { introId, decision } = parsed.data;

  // The note only goes with "Interested".
  let note: string | null = null;
  if (decision === "interested") {
    const checked = validateIntroNote(parsed.data.note ?? "");
    if (!checked.ok) return { fieldErrors: { note: [checked.error] } };
    note = checked.note;
  }

  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) {
    return { error: "This server is not set up yet." };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Please log in again." };
  const userId = data.user.id;

  const result = await decideIntroInDb(service, {
    viewerId: userId,
    introId,
    decision,
    note,
  });
  if (!result) {
    return { error: "We could not save that. Please try again." };
  }

  // Which cap to name in the message. Read with the member's own client.
  const { data: me } = await supabase
    .from("profiles")
    .select("plus_until")
    .eq("id", userId)
    .maybeSingle();
  const cap = chatCap((me?.plus_until as string | null) ?? null, new Date());

  // Events carry no personal data: only what kind of thing happened.
  const { outcome } = result;
  if (outcome.kind === "passed") {
    await logEvent("intro_passed", userId);
  } else if (
    outcome.kind === "interest_saved" ||
    outcome.kind === "opened" ||
    outcome.kind === "already_open"
  ) {
    await logEvent("intro_interested", userId, { has_note: note !== null });
  }
  if (outcome.kind === "opened") {
    await logEvent("conversation_opened", userId, { opener: outcome.opener });
  }
  if (outcome.kind === "viewer_at_cap") {
    await logEvent("cap_blocked", userId, { side: "viewer" });
  } else if (
    outcome.kind === "interest_saved" &&
    outcome.reason === "other_at_cap"
  ) {
    await logEvent("cap_blocked", userId, { side: "other" });
  }

  revalidatePath("/shortlist");
  revalidatePath("/chat");
  revalidatePath("/home");

  const notice = noticeFor(outcome, cap);
  return notice.tone === "warning"
    ? { error: notice.text }
    : { message: notice.text };
}

// ---------------------------------------------------------------------------
// Second look (Plus): bring one passed or expired intro back.
// ---------------------------------------------------------------------------
// The database function checks everything that matters (Plus is active, one
// every 30 days, the intro is yours and from the last four weeks, the other
// person is still around and not blocked); this action only passes the
// verified member id and the intro id.
const SECOND_LOOK_TEXT: Record<string, string> = {
  not_plus: "A second look is part of Plus.",
  used_recently: "You have already used your second look for this period.",
  too_old: "That intro is more than four weeks old.",
  already_revived: "That intro is already back on your shortlist.",
  not_eligible: "Only an intro you passed on or let expire can come back.",
  unavailable: "That person is not available any more.",
  not_found: "We could not find that intro.",
};

export async function secondLookAction(
  introId: string,
): Promise<{ ok: boolean; message: string }> {
  const parsed = z.uuid().safeParse(introId);
  if (!parsed.success)
    return { ok: false, message: "That intro is not valid." };
  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) {
    return { ok: false, message: "This server is not set up yet." };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, message: "Please log in again." };

  const { data: out, error } = await service.rpc("use_second_look", {
    p_user: data.user.id,
    p_intro: parsed.data,
    p_per_days: SECOND_LOOK.perDays,
    p_lookback_days: SECOND_LOOK.lookbackDays,
    p_revived_hours: SECOND_LOOK.revivedHours,
    p_expiry_minutes: SHORTLIST_CONFIG.introExpiryMinutesAfterWeekStart,
  });
  if (error || !out) {
    return { ok: false, message: "We could not do that. Please try again." };
  }
  const result = (out as { result: string }).result;
  if (result !== "revived") {
    return {
      ok: false,
      message: SECOND_LOOK_TEXT[result] ?? "We could not do that.",
    };
  }
  revalidatePath("/shortlist");
  return {
    ok: true,
    message: `Brought back. It is on your shortlist for the next ${SECOND_LOOK.revivedHours} hours.`,
  };
}
