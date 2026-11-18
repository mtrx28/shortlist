import { CONVERSATION_CONFIG } from "@/config/conversation";
import { SHORTLIST_CONFIG } from "@/config/shortlist";

// The "Demo controls" panel lets an evaluator move a chat's clock forward, so
// the 48 hour nudge, the day-3 decision and expiry can be seen without waiting
// days. It is dangerous in a real product, so it has three locks:
//   1. the DEMO_CONTROLS=true setting (off unless someone turns it on),
//   2. the chat must involve a demo account (app_metadata.demo = true, which
//      only the seed script can set), and
//   3. the person pressing the button must be in the chat (or be an admin).

export type FastForwardStep = "day3" | "almost_over" | "expire";

export const FAST_FORWARD_STEPS: {
  step: FastForwardStep;
  label: string;
  help: string;
}[] = [
  {
    step: "day3",
    label: "Jump to day 3 (49 hours in)",
    help: "Shows the 48 hour reminder, and the Keep or Close choice once both have written.",
  },
  {
    step: "almost_over",
    label: "Leave 4 hours",
    help: "The chat has 4 hours left.",
  },
  {
    step: "expire",
    label: "Make the time run out",
    help: "The window ends now. The chat ends the next time the hourly job runs (call /api/cron/expire).",
  },
];

export function demoControlsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.DEMO_CONTROLS === "true";
}

export type DemoGuardInput = {
  enabled: boolean;
  actorId: string;
  actorIsAdmin: boolean;
  userA: string;
  userB: string;
  // app_metadata.demo for each account, by id
  demoAccounts: Record<string, boolean>;
};

export type DemoGuardResult =
  { ok: true } | { ok: false; reason: "disabled" | "not_demo" | "not_allowed" };

export function demoGuard(input: DemoGuardInput): DemoGuardResult {
  if (!input.enabled) return { ok: false, reason: "disabled" };
  const involvesDemo =
    input.demoAccounts[input.userA] === true ||
    input.demoAccounts[input.userB] === true;
  if (!involvesDemo) return { ok: false, reason: "not_demo" };
  const inChat = input.actorId === input.userA || input.actorId === input.userB;
  if (!inChat && !input.actorIsAdmin)
    return { ok: false, reason: "not_allowed" };
  return { ok: true };
}

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;

// The new times for a chat. The clock only ever moves forward (opened_at and
// window_ends_at only move earlier), so pressing a button twice, or on a chat
// that is already older, never rewinds it.
export function shiftedTimes(
  step: FastForwardStep,
  now: Date,
  current: { openedAt: Date; windowEndsAt: Date },
  windowHours: number = SHORTLIST_CONFIG.windowHours,
): { openedAt: Date; windowEndsAt: Date } {
  let openedAt: number;
  let windowEndsAt: number;
  if (step === "day3") {
    openedAt =
      now.getTime() - (CONVERSATION_CONFIG.decisionOpensAfterHours + 1) * HOUR;
    windowEndsAt = openedAt + windowHours * HOUR;
  } else if (step === "almost_over") {
    windowEndsAt = now.getTime() + 4 * HOUR;
    openedAt = windowEndsAt - windowHours * HOUR;
  } else {
    windowEndsAt = now.getTime() - MINUTE;
    openedAt = windowEndsAt - windowHours * HOUR;
  }
  return {
    openedAt: new Date(Math.min(openedAt, current.openedAt.getTime())),
    windowEndsAt: new Date(
      Math.min(windowEndsAt, current.windowEndsAt.getTime()),
    ),
  };
}
