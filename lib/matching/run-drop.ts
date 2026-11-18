// Runs one weekly drop: load people and history, call the pure engine, save
// the result. The loading and saving sit behind a small "store" interface so
// the steps here can be tested without a real database (the Supabase version
// is in supabase-store.ts).

import { MATCHING_CONFIG, type MatchingConfig } from "@/config/matching";
import { ageOn, parseIsoDate } from "@/lib/age";
import { isPlus } from "@/lib/plus";
import { buildDrop } from "./build-drop";
import type {
  DropHistory,
  DropStats,
  Gender,
  Intent,
  IntroRow,
  MatchUser,
  ValueAnswers,
} from "./types";
import { dropWeekStart, weeksBefore } from "./week";

// A row of the profiles table, only the columns matching needs.
export type ProfileRow = {
  id: string;
  gender: Gender | null;
  interested_in: Gender[] | null;
  city: string | null;
  intent: Intent | null;
  batch_year: number | null;
  dob: string; // YYYY-MM-DD, read with the service role only
  values_answers: ValueAnswers | null;
  interests: string[] | null;
  paused: boolean;
  suspended_at: string | null;
  deleted_at: string | null;
  onboarding_completed_at: string | null;
  plus_until: string | null;
  reply_rate_num: number;
  reply_rate_den: number;
};

export type WriteDropResult = {
  status: "created" | "exists" | "blocked";
  dropId?: string;
  intros?: number;
};

export interface DropStore {
  loadProfiles(): Promise<ProfileRow[]>;
  // Intros shown from `fromWeek` (inclusive) up to `weekStart` (exclusive),
  // all blocks, and pairs with a live conversation.
  loadHistory(fromWeek: string, weekStart: string): Promise<DropHistory>;
  writeDrop(args: {
    weekStart: string;
    stats: Record<string, unknown>;
    intros: IntroRow[];
    rebuild: boolean;
  }): Promise<WriteDropResult>;
}

export type RunDropOptions = {
  now?: Date;
  seed?: string; // default: the week, so a re-run gives the same drop
  rebuild?: boolean; // replace this week's drop if nobody has acted on it
  source?: "cron" | "admin";
  config?: MatchingConfig;
};

export type RunDropOutcome = {
  status: WriteDropResult["status"];
  weekStart: string;
  dropId?: string;
  stats?: DropStats; // only when a drop was created
};

export function rowToMatchUser(row: ProfileRow, now: Date): MatchUser {
  const dob = parseIsoDate(row.dob);
  return {
    id: row.id,
    gender: row.gender,
    interestedIn: row.interested_in ?? [],
    age: dob ? ageOn(dob, now) : 0,
    city: row.city,
    intent: row.intent,
    batchYear: row.batch_year,
    interests: row.interests ?? [],
    values: row.values_answers ?? {},
    paused: row.paused,
    deleted: row.deleted_at !== null,
    suspended: row.suspended_at !== null,
    onboarded: row.onboarding_completed_at !== null,
    isPlus: isPlus(row.plus_until, now),
    repliesNum: row.reply_rate_num,
    repliesDen: row.reply_rate_den,
  };
}

export async function runDrop(
  store: DropStore,
  options: RunDropOptions = {},
): Promise<RunDropOutcome> {
  const now = options.now ?? new Date();
  const config = options.config ?? MATCHING_CONFIG;
  const weekStart = dropWeekStart(now);
  const seed = options.seed ?? `drop:${weekStart}`;

  const [rows, history] = await Promise.all([
    store.loadProfiles(),
    store.loadHistory(weeksBefore(weekStart, config.noRepeatWeeks), weekStart),
  ]);
  const users = rows.map((row) => rowToMatchUser(row, now));
  const { intros, stats } = buildDrop(
    users,
    { ...history, weekStart },
    config,
    seed,
  );

  const written = await store.writeDrop({
    weekStart,
    stats: { ...stats, source: options.source ?? "admin" },
    intros,
    rebuild: options.rebuild ?? false,
  });

  return {
    status: written.status,
    weekStart,
    dropId: written.dropId,
    stats: written.status === "created" ? stats : undefined,
  };
}
