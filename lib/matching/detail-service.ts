import type { SupabaseClient } from "@supabase/supabase-js";
import { MATCHING_CONFIG } from "@/config/matching";
import { buildMatchDetail, type MatchDetail } from "./detail";
import { skipReason, toMember } from "./filters";
import { rowToMatchUser, type ProfileRow } from "./run-drop";

// Loads the "why we matched" breakdown for a Plus member's intros. It reads
// both people's answers with the service role (members cannot read each
// other's answers), but only the finished sentences from buildMatchDetail()
// ever leave the server. Date of birth is not needed, so it is not read.
const COLUMNS =
  "id, gender, interested_in, city, intent, batch_year, values_answers, interests, paused, suspended_at, deleted_at, onboarding_completed_at, plus_until, reply_rate_num, reply_rate_den";

export async function loadMatchDetails(
  service: SupabaseClient,
  viewerId: string,
  candidateIds: string[],
  now: Date,
): Promise<Map<string, MatchDetail>> {
  const out = new Map<string, MatchDetail>();
  if (candidateIds.length === 0) return out;

  const { data } = await service
    .from("profiles")
    .select(COLUMNS)
    .in("id", [viewerId, ...candidateIds]);
  const rows = (data ?? []) as unknown as Omit<ProfileRow, "dob">[];
  const members = new Map(
    rows.flatMap((row) => {
      // The age is not used by the breakdown; a placeholder birth date keeps
      // the shared row-to-person code usable.
      const user = rowToMatchUser({ ...row, dob: "2000-01-01" }, now);
      return skipReason(user) === null
        ? ([[row.id, toMember(user)]] as const)
        : [];
    }),
  );

  const viewer = members.get(viewerId);
  if (!viewer) return out;
  for (const id of candidateIds) {
    const candidate = members.get(id);
    if (candidate) {
      out.set(id, buildMatchDetail(viewer, candidate, MATCHING_CONFIG));
    }
  }
  return out;
}
