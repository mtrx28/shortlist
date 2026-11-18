// Reads the stats saved with a drop (drops.stats, a JSON column) for the admin
// page. Old or demo drops have other shapes, so this checks before trusting it.

import type { DropStats, ZeroIntroReason } from "./types";

export function readDropStats(value: unknown): DropStats | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<DropStats>;
  if (
    typeof v.usersEligible !== "number" ||
    typeof v.introsCreated !== "number" ||
    !v.zeroIntroReasons ||
    !v.shortlistAppearances ||
    !v.skipped
  ) {
    return null;
  }
  return v as DropStats;
}

export const ZERO_REASON_LABELS: Record<ZeroIntroReason, string> = {
  no_compatible_people: "Nobody passed the filters (city, preferences, age)",
  already_seen: "Everyone left was shown to them recently",
  below_min_score: "People passed the filters but were not close enough",
  candidates_full: "Good candidates were already in 5 shortlists",
};

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
