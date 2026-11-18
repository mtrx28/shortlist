// The numbers and words behind reporting, blocking and moderation. Like the
// other config files, the limits live here and the server passes them to the
// database functions, so there is one place to change them.

export const SAFETY_CONFIG = {
  // Rate limits, counted by the database over the last 24 hours. They stop
  // reporting and blocking from being used to flood the moderators.
  maxReportsPerDay: 5,
  maxBlocksPerDay: 20,
  // How many of the latest messages a reporter can attach as evidence.
  maxEvidenceMessages: 20,

  // Contact form (the grievance page): per sender and for everybody.
  contactPerSenderPerDay: 3,
  contactGlobalPerDay: 100,

  // Data export: how many times a day one person can download their data.
  exportsPerDay: 3,

  // Deleting an account asks for the password again; after this many wrong
  // tries within an hour we stop asking and say try later.
  deleteReauthMaxFailuresPerHour: 5,
  // The word typed to confirm deletion.
  deleteConfirmPhrase: "DELETE",

  // Moderation timers shown in the admin queue. These are my DRAFT targets,
  // modelled on the usual "acknowledge quickly, resolve within a few weeks"
  // grievance pattern. They are not a statement of what the law requires.
  ackWithinHours: 24,
  resolveWithinDays: 15,
} as const;

export const REPORT_REASONS = [
  { id: "harassment", label: "Harassment or abuse" },
  { id: "fake_profile", label: "Fake profile or pretending to be someone" },
  { id: "scam", label: "Scam, or asking for money" },
  { id: "inappropriate_content", label: "Inappropriate photos or messages" },
  { id: "underage", label: "Seems to be under 18" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReasonId = (typeof REPORT_REASONS)[number]["id"];

export function reasonLabel(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
}

// What we say right after someone reports, in plain words. Shown on screen.
export const REPORT_RECEIVED_TEXT =
  "Thank you. We have your report. A person on our team will look at it and acknowledge it within 24 hours. You do not need to do anything else. The person you reported is not told that you reported them.";

export const REPORT_ALREADY_TEXT =
  "You already have an open report about this person, so we have kept that one. We will look at it within 24 hours.";

export const BLOCK_DONE_TEXT =
  "Done. You will not see each other again, any chat between you has ended, and you will not be matched. They are not told that you blocked them.";
