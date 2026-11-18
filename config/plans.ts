import { MATCHING_CONFIG } from "@/config/matching";
import { SHORTLIST_CONFIG } from "@/config/shortlist";

// What Plus is, what it costs, and what it will never cost. The server reads
// the price from here and nowhere else: the browser never sends an amount.
//
// Amounts are in paise (1 rupee = 100 paise), the unit Razorpay uses, so no
// decimals are ever needed. Prices include 18% GST (I assume that rate applies
// to this kind of digital service; to be checked with an accountant).

export type PlanId = "plus_1m" | "plus_3m";

export type Plan = {
  id: PlanId;
  label: string;
  amountPaise: number;
  days: number; // how long Plus lasts from the moment it is granted
  blurb: string;
};

export const PLANS: Record<PlanId, Plan> = {
  plus_1m: {
    id: "plus_1m",
    label: "1 month",
    amountPaise: 19900,
    days: 30,
    blurb: "Try it for a month",
  },
  plus_3m: {
    id: "plus_3m",
    label: "3 months",
    amountPaise: 49900,
    days: 90,
    blurb: "About a dating cycle, and cheaper per month",
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export const CURRENCY = "INR" as const;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && Object.hasOwn(PLANS, value);
}

// "Rs 199", "Rs 499" (whole rupees; no plan has paise).
export function formatRupees(amountPaise: number): string {
  const rupees = amountPaise / 100;
  return `Rs ${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}

// Limits around buying.
export const PAYMENT_LIMITS = {
  // Orders one person may create per hour. Stops someone from filling the
  // orders table (and our payment provider account) with unpaid orders.
  ordersPerHour: 5,
  // The "grant 30 days" button for demo accounts.
  demoGrantDays: 30,
} as const;

// "Second look": once a month a Plus member can bring back one intro they
// passed on or let expire. It comes back for a short time, and if the other
// person had said Interested in that same drop, a chat opens the usual way.
export const SECOND_LOOK = {
  perDays: 30, // one every 30 days
  lookbackDays: 28, // only intros from the last four weeks
  revivedHours: 72, // how long the brought-back intro stays answerable
} as const;

// What Plus changes. The numbers are NOT repeated here: each one points at the
// setting the rest of the app already uses, so the paywall page, the matching
// engine and the chat cap cannot disagree.
export const PLUS_PERKS = {
  chatCap: SHORTLIST_CONFIG.chatCapPlus,
  introsPerDrop: MATCHING_CONFIG.introsPlus,
  reasonsDetail: true,
  secondLookPerMonth: 1,
} as const;

export const FREE_LIMITS = {
  chatCap: SHORTLIST_CONFIG.chatCapFree,
  introsPerDrop: MATCHING_CONFIG.introsFree,
} as const;

// The "never paywalled" list. These are promises from the monetization
// decision: safety, trust and the core weekly intros are free for everybody.
// A test (tests/unit/plus-never-paywalled.test.ts) checks that none of the
// code that implements them looks at Plus, so adding a paywall to one of them
// later breaks the build.
export const NEVER_PAYWALLED = [
  {
    key: "report_and_block",
    label: "Reporting and blocking anyone",
    paths: ["app/safety", "lib/safety", "components/safety"],
  },
  {
    key: "verification",
    label: "Email and eLitmus verification",
    paths: ["lib/elitmus.ts", "components/profile/verification-card.tsx"],
  },
  {
    key: "account_tools",
    label: "Data export, account deletion and consent withdrawal",
    paths: ["app/account", "lib/account", "components/account"],
  },
  {
    key: "being_seen",
    label: "Being in other people's weekly shortlists",
    paths: ["lib/matching/filters.ts", "lib/matching/score.ts"],
  },
  {
    key: "weekly_intros",
    label: "The core weekly intros (3 a week) and answering them",
    paths: ["lib/shortlist/decide.ts"],
  },
  {
    key: "messaging",
    label: "Sending and receiving messages in a chat you have",
    paths: ["lib/conversation/message.ts", "lib/conversation/state.ts"],
  },
  {
    key: "grievance",
    label: "The grievance and contact page",
    paths: ["app/grievance"],
  },
] as const;
