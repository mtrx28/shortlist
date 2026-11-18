import type { SupabaseClient } from "@supabase/supabase-js";
import { chatCap } from "@/lib/shortlist/caps";
import { retryWaitingChats } from "@/lib/shortlist/service";

// When a chat closes or expires, a slot is free for both people. Two kinds of
// match may have been waiting for it:
//   * the person's own "Interested" that could not open because THEY were at
//     their cap, and
//   * other people's "Interested" in this person that could not open because
//     THIS person was at their cap.
// retryWaitingChats(user) repeats a user's own waiting "Interested" answers,
// so we call it for the freed people and for everybody who is waiting on them.
// decide_intro() re-checks every rule, so a retry that is not allowed simply
// does nothing. The number of people retried is bounded.

const MAX_PEOPLE = 60;

export async function waitingOn(
  service: SupabaseClient,
  freedUserIds: string[],
): Promise<string[]> {
  if (freedUserIds.length === 0) return [];
  const { data: drop } = await service
    .from("drops")
    .select("id")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!drop) return [];
  const { data } = await service
    .from("intros")
    .select("viewer_id")
    .eq("drop_id", drop.id)
    .eq("status", "interested")
    .in("candidate_id", freedUserIds)
    .limit(MAX_PEOPLE);
  return (data ?? []).map((r) => r.viewer_id as string);
}

// Returns how many chats were opened by the retries.
export async function retryAfterSlotsFreed(
  service: SupabaseClient,
  freedUserIds: string[],
  now: Date = new Date(),
): Promise<number> {
  const waiting = await waitingOn(service, freedUserIds);
  const people = [...new Set([...freedUserIds, ...waiting])].slice(
    0,
    MAX_PEOPLE,
  );
  if (people.length === 0) return 0;

  const { data: profiles } = await service
    .from("profiles")
    .select("id, plus_until, paused")
    .in("id", people);

  let opened = 0;
  for (const p of profiles ?? []) {
    if (p.paused) continue;
    const cap = chatCap((p.plus_until as string | null) ?? null, now);
    try {
      const ids = await retryWaitingChats(service, p.id as string, cap, now);
      opened += ids.length;
    } catch {
      // One failed retry must not stop the others, or the job itself.
    }
  }
  return opened;
}
