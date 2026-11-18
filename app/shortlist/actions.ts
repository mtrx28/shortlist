"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
