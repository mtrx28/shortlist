// What happens when someone answers an intro. This is the rulebook in plain
// TypeScript. The real work is done by the decide_intro() database function
// (supabase/migrations/..._shortlist_decisions.sql), which follows the same
// steps in the same order inside one transaction; a test runs the same cases
// through both so they cannot drift apart. This file is also where the rules
// are easiest to read and unit-test.
//
// The rules in short:
//  1. Only the owner of an intro that has not expired can answer it.
//  2. Pass is silent and can be repeated. Interested after Pass (or Pass after
//     Interested) is refused: an answer is final.
//  3. Interested is saved. A chat opens only if the other person is
//     interested too (same drop), nobody is blocked, and both have a free
//     chat slot. So one side's interest alone never opens a chat.
//  4. In a man-woman pair the woman opens (writes first). Otherwise the
//     person who showed interest first opens.
//  5. If YOU are at your chat cap you cannot say Interested (nothing saved).
//     If the OTHER person is at their cap your interest is saved and the chat
//     opens on a later retry. You are told the same neutral thing as when you
//     are simply waiting.

export type Gender = "woman" | "man" | "non_binary";
export type Decision = "interested" | "passed";
export type IntroStatus = "new" | "passed" | "interested" | "expired";

export type Person = {
  id: string;
  gender: Gender | null;
  openChats: number;
  cap: number;
  // false when the account is paused, suspended, deleted or not set up
  available: boolean;
};

export type DecideInput = {
  decision: Decision;
  viewer: Person;
  // The intro being answered; null when it does not exist.
  intro: {
    ownerId: string;
    status: IntroStatus;
    expired: boolean; // its week has passed
    decidedAtMs: number; // when it was answered (the current time if it is new)
  } | null;
  // The other person.
  other: Person & {
    blocked: boolean; // either of the two blocked the other
    // Their intro about the viewer in the same drop (null if none).
    introStatus: IntroStatus | null;
    introDecidedAtMs: number;
  };
  // An open or kept chat between the two already exists.
  hasLiveChat: boolean;
  // A chat already came from these two intros and has ended. One chat per
  // mutual interest: it is not opened again.
  hadChatFromTheseIntros?: boolean;
};

export type RejectReason =
  "not_found" | "viewer_unavailable" | "expired" | "already_decided";

export type DecideOutcome =
  | { kind: "rejected"; reason: RejectReason }
  | { kind: "passed" }
  | { kind: "viewer_at_cap" }
  | {
      kind: "interest_saved";
      reason: "waiting" | "other_at_cap" | "unavailable" | "already_chatted";
    }
  | { kind: "already_open" }
  | { kind: "opened"; opener: "viewer" | "other" };

// Who writes first. womanOpens = the woman-first rule; when it does not apply
// the earlier "Interested" wins, and an exact tie goes to the smaller id.
export function chooseOpener(
  a: { id: string; gender: Gender | null; decidedAtMs: number },
  b: { id: string; gender: Gender | null; decidedAtMs: number },
  womanOpens: boolean,
): "a" | "b" {
  if (womanOpens) {
    if (a.gender === "woman" && b.gender === "man") return "a";
    if (a.gender === "man" && b.gender === "woman") return "b";
  }
  if (a.decidedAtMs !== b.decidedAtMs) {
    return a.decidedAtMs < b.decidedAtMs ? "a" : "b";
  }
  return a.id < b.id ? "a" : "b";
}

export function decideIntro(
  input: DecideInput,
  options: { womanOpens: boolean },
): DecideOutcome {
  const { viewer, intro, other } = input;

  if (!intro || intro.ownerId !== viewer.id) {
    return { kind: "rejected", reason: "not_found" };
  }
  if (!viewer.available) {
    return { kind: "rejected", reason: "viewer_unavailable" };
  }
  if (intro.status === "expired" || intro.expired) {
    return { kind: "rejected", reason: "expired" };
  }

  if (input.decision === "passed") {
    if (intro.status === "interested") {
      return { kind: "rejected", reason: "already_decided" };
    }
    return { kind: "passed" };
  }

  // Interested
  if (intro.status === "passed") {
    return { kind: "rejected", reason: "already_decided" };
  }
  if (intro.status === "new" && viewer.openChats >= viewer.cap) {
    return { kind: "viewer_at_cap" };
  }

  // Saved. Now see whether a chat can open.
  if (other.introStatus !== "interested") {
    return { kind: "interest_saved", reason: "waiting" };
  }
  if (!other.available || other.blocked) {
    return { kind: "interest_saved", reason: "unavailable" };
  }
  if (input.hasLiveChat) return { kind: "already_open" };
  if (input.hadChatFromTheseIntros) {
    return { kind: "interest_saved", reason: "already_chatted" };
  }
  if (viewer.openChats >= viewer.cap) return { kind: "viewer_at_cap" };
  if (other.openChats >= other.cap) {
    return { kind: "interest_saved", reason: "other_at_cap" };
  }

  const first = chooseOpener(
    { id: viewer.id, gender: viewer.gender, decidedAtMs: intro.decidedAtMs },
    { id: other.id, gender: other.gender, decidedAtMs: other.introDecidedAtMs },
    options.womanOpens,
  );
  return { kind: "opened", opener: first === "a" ? "viewer" : "other" };
}
