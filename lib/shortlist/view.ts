import { introExpiresAt } from "@/lib/shortlist/time";
import type { IntroStatus } from "@/lib/shortlist/decide";

// Decides which of the Shortlist screens to show. Pure, so every empty state
// is covered by a test.

export type ShortlistScreen =
  | "paused" // the member paused their profile
  | "no_drop" // no weekly drop has ever run
  | "between_drops" // the last drop's week is over and the next one is not out yet
  | "no_intros" // a drop ran but nobody was found for this member
  | "all_decided" // every intro has been answered
  | "intros"; // there is something to answer

export type ShortlistView = {
  screen: ShortlistScreen;
  left: number; // intros still to answer
  total: number;
  expiresAt: Date | null;
};

export function buildShortlistView(args: {
  paused: boolean;
  latestWeek: string | null; // Monday of the latest drop
  statuses: IntroStatus[]; // the member's intros in that drop
  now: Date;
}): ShortlistView {
  const total = args.statuses.length;
  const left = args.statuses.filter((s) => s === "new").length;
  const expiresAt = args.latestWeek ? introExpiresAt(args.latestWeek) : null;
  const base = { left, total, expiresAt };

  if (args.paused) return { screen: "paused", ...base };
  if (!args.latestWeek || !expiresAt) return { screen: "no_drop", ...base };
  if (args.now.getTime() >= expiresAt.getTime()) {
    return { screen: "between_drops", ...base };
  }
  if (total === 0) return { screen: "no_intros", ...base };
  if (left === 0) return { screen: "all_decided", ...base };
  return { screen: "intros", ...base };
}
