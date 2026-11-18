import { FREE_LIMITS, PLUS_PERKS } from "@/config/plans";

// The one place that answers "does this person have Plus, and what does that
// change?". The shortlist caps, the weekly drop, the "why we matched" detail
// and the paywall page all ask here, so they cannot disagree.
//
// Plus is active while plus_until is in the future. When it runs out nothing is
// deleted: chats already open stay open (only opening NEW ones past the free
// limit is blocked), and the next drop gives the free number of intros.

export type PlusUntil = string | Date | null | undefined;

export function isPlus(plusUntil: PlusUntil, now: Date): boolean {
  if (!plusUntil) return false;
  const until = new Date(plusUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

export type Entitlements = {
  isPlus: boolean;
  chatCap: number; // chats open at once
  introsPerDrop: number;
  reasonsDetail: boolean; // the full "why we matched" breakdown
  secondLook: boolean; // one revived intro every 30 days
};

export function entitlements(plusUntil: PlusUntil, now: Date): Entitlements {
  if (isPlus(plusUntil, now)) {
    return {
      isPlus: true,
      chatCap: PLUS_PERKS.chatCap,
      introsPerDrop: PLUS_PERKS.introsPerDrop,
      reasonsDetail: PLUS_PERKS.reasonsDetail,
      secondLook: PLUS_PERKS.secondLookPerMonth > 0,
    };
  }
  return {
    isPlus: false,
    chatCap: FREE_LIMITS.chatCap,
    introsPerDrop: FREE_LIMITS.introsPerDrop,
    reasonsDetail: false,
    secondLook: false,
  };
}

// When a purchase of `days` days would end, if it is granted at `now`. A
// member who buys again while still on Plus gets the time added to the end of
// what they have, not from today (so buying early never wastes days). This is
// the same rule as the SQL function plus_extend(), kept here so it is tested.
export function plusEndAfterPurchase(
  currentPlusUntil: PlusUntil,
  days: number,
  now: Date,
): Date {
  const start =
    isPlus(currentPlusUntil, now) && currentPlusUntil
      ? new Date(currentPlusUntil)
      : now;
  return new Date(start.getTime() + days * 24 * 3600 * 1000);
}
