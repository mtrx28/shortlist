import type { SupabaseClient } from "@supabase/supabase-js";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import type { DecideOutcome, Decision } from "@/lib/shortlist/decide";
import { introExpiresAt } from "@/lib/shortlist/time";

// Calls the decide_intro() database function and turns its answer into the
// same outcome type the pure rules use. It needs the service-role client
// (the function is not callable by signed-in users, see the migration), so
// the caller must pass the viewer id of the VERIFIED session.

export type DecideResult = {
  outcome: DecideOutcome;
  conversationId: string | null;
};

type RawResult = {
  status?: string;
  reason?: string;
  conversation_id?: string | null;
  opener_id?: string | null;
};

// Turns the function's JSON into an outcome. "opened" needs to know who the
// opener is relative to the viewer.
export function outcomeFromResult(
  raw: RawResult,
  viewerId: string,
): DecideOutcome | null {
  switch (raw.status) {
    case "passed":
      return { kind: "passed" };
    case "viewer_at_cap":
      return { kind: "viewer_at_cap" };
    case "already_open":
      return { kind: "already_open" };
    case "opened":
      return {
        kind: "opened",
        opener: raw.opener_id === viewerId ? "viewer" : "other",
      };
    case "interest_saved":
      if (
        raw.reason === "waiting" ||
        raw.reason === "other_at_cap" ||
        raw.reason === "unavailable"
      ) {
        return { kind: "interest_saved", reason: raw.reason };
      }
      return null;
    default:
      return null;
  }
}

// The function raises short codes (see the migration).
export function outcomeFromError(
  message: string | undefined,
): DecideOutcome | null {
  if (!message) return null;
  if (message.includes("intro_not_found")) {
    return { kind: "rejected", reason: "not_found" };
  }
  if (message.includes("intro_expired")) {
    return { kind: "rejected", reason: "expired" };
  }
  if (message.includes("already_decided")) {
    return { kind: "rejected", reason: "already_decided" };
  }
  if (message.includes("viewer_unavailable")) {
    return { kind: "rejected", reason: "viewer_unavailable" };
  }
  return null; // anything else is a real failure
}

export async function decideIntroInDb(
  service: SupabaseClient,
  args: {
    viewerId: string;
    introId: string;
    decision: Decision;
    note: string | null;
  },
): Promise<DecideResult | null> {
  const { data, error } = await service.rpc("decide_intro", {
    p_viewer: args.viewerId,
    p_intro: args.introId,
    p_decision: args.decision,
    p_note: args.note,
    p_free_cap: SHORTLIST_CONFIG.chatCapFree,
    p_plus_cap: SHORTLIST_CONFIG.chatCapPlus,
    p_window_hours: SHORTLIST_CONFIG.windowHours,
    p_expiry_minutes: SHORTLIST_CONFIG.introExpiryMinutesAfterWeekStart,
    p_woman_opens: SHORTLIST_CONFIG.womanOpens,
  });

  if (error) {
    const outcome = outcomeFromError(error.message);
    return outcome ? { outcome, conversationId: null } : null;
  }
  const raw = (data ?? {}) as RawResult;
  const outcome = outcomeFromResult(raw, args.viewerId);
  if (!outcome) return null;
  return { outcome, conversationId: raw.conversation_id ?? null };
}

// A chat that could not open earlier (the other person was at their cap) gets
// another try. Nothing here decides anything new: it repeats "Interested" for
// intros the person already said Interested to, which decide_intro treats as
// a retry. Called when a member opens Shortlist or Chats, so a freed slot is
// used without a background job. Returns how many chats opened.
export async function retryWaitingChats(
  service: SupabaseClient,
  userId: string,
  cap: number,
  now: Date = new Date(),
): Promise<string[]> {
  const { data: drop } = await service
    .from("drops")
    .select("id, week_start")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!drop || now >= introExpiresAt(drop.week_start as string)) return [];

  const { data: waiting } = await service
    .from("intros")
    .select("id, candidate_id")
    .eq("drop_id", drop.id)
    .eq("viewer_id", userId)
    .eq("status", "interested")
    .limit(10);
  if (!waiting || waiting.length === 0) return [];

  const { data: chats } = await service
    .from("conversations")
    .select("user_a, user_b")
    .in("status", ["open", "kept"])
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  // Nothing can open while this person is at their cap.
  if ((chats ?? []).length >= cap) return [];
  const chatting = new Set(
    (chats ?? []).flatMap((c) => [c.user_a as string, c.user_b as string]),
  );

  const opened: string[] = [];
  for (const intro of waiting) {
    if (chatting.has(intro.candidate_id as string)) continue;
    const result = await decideIntroInDb(service, {
      viewerId: userId,
      introId: intro.id as string,
      decision: "interested",
      note: null,
    });
    if (result?.outcome.kind === "opened" && result.conversationId) {
      opened.push(result.conversationId);
    }
  }
  return opened;
}
