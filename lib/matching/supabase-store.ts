// The Supabase side of the drop: reads with the service-role client and saves
// through the write_drop() database function (see the write_drop migration).
// Server only: the service role skips row level security.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DropHistory, IntroRow } from "./types";
import type { DropStore, ProfileRow, WriteDropResult } from "./run-drop";

const PAGE = 1000; // Supabase returns at most 1000 rows per request

// Keeps asking for pages until one comes back short.
async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Loading ${label} failed: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return all;
  }
}

const PROFILE_COLUMNS =
  "id, gender, interested_in, city, intent, batch_year, dob, values_answers, interests, paused, suspended_at, deleted_at, onboarding_completed_at, plus_until, reply_rate_num, reply_rate_den";

export class SupabaseDropStore implements DropStore {
  constructor(private db: SupabaseClient) {}

  // Everyone is loaded (the engine decides who is eligible, and counts who
  // was skipped). Fine for thousands of people; at a larger scale this would
  // filter by city in SQL and run one city at a time.
  loadProfiles() {
    return fetchAll<ProfileRow>(
      (from, to) =>
        this.db
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .order("id")
          .range(from, to),
      "profiles",
    );
  }

  async loadHistory(fromWeek: string, weekStart: string): Promise<DropHistory> {
    type SeenRow = {
      viewer_id: string;
      candidate_id: string;
      drops: { week_start: string } | { week_start: string }[];
    };
    const seenRows = await fetchAll<SeenRow>(
      (from, to) =>
        this.db
          .from("intros")
          .select("viewer_id, candidate_id, drops!inner(week_start)")
          .gte("drops.week_start", fromWeek)
          .lt("drops.week_start", weekStart)
          .order("id")
          .range(from, to) as unknown as PromiseLike<{
          data: SeenRow[] | null;
          error: { message: string } | null;
        }>,
      "earlier intros",
    );
    const blockRows = await fetchAll<{
      blocker_id: string;
      blocked_id: string;
    }>(
      (from, to) =>
        this.db
          .from("blocks")
          .select("blocker_id, blocked_id")
          .order("blocker_id")
          .order("blocked_id")
          .range(from, to),
      "blocks",
    );
    const convoRows = await fetchAll<{ user_a: string; user_b: string }>(
      (from, to) =>
        this.db
          .from("conversations")
          .select("user_a, user_b")
          .in("status", ["open", "kept"])
          .order("id")
          .range(from, to),
      "conversations",
    );

    return {
      weekStart,
      seen: seenRows.map((r) => ({
        viewerId: r.viewer_id,
        candidateId: r.candidate_id,
        weekStart: Array.isArray(r.drops)
          ? r.drops[0].week_start
          : r.drops.week_start,
      })),
      blocks: blockRows.map((r) => ({
        blockerId: r.blocker_id,
        blockedId: r.blocked_id,
      })),
      connected: convoRows.map((r) => ({ a: r.user_a, b: r.user_b })),
    };
  }

  async writeDrop(args: {
    weekStart: string;
    stats: Record<string, unknown>;
    intros: IntroRow[];
    rebuild: boolean;
  }): Promise<WriteDropResult> {
    const { data, error } = await this.db.rpc("write_drop", {
      p_week_start: args.weekStart,
      p_stats: args.stats,
      p_intros: args.intros.map((i) => ({
        viewer_id: i.viewerId,
        candidate_id: i.candidateId,
        score: i.score,
        reasons: i.reasons,
      })),
      p_replace_demo: true,
      p_rebuild: args.rebuild,
    });
    if (error) throw new Error(`Saving the drop failed: ${error.message}`);
    const out = data as {
      status: WriteDropResult["status"];
      drop_id?: string;
      intros?: number;
    };
    return { status: out.status, dropId: out.drop_id, intros: out.intros };
  }
}
