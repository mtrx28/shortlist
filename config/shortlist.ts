// The rules for answering intros and opening chats. Like config/matching.ts,
// the numbers live here so they can be tuned without touching the logic. The
// database function decide_intro() receives these values from the server; it
// does not have its own copy, so there is one place to change them.

export const SHORTLIST_CONFIG = {
  // How many chats a person can have open at once ("open" and "kept" both count).
  chatCapFree: 3,
  chatCapPlus: 5,

  // How long a new chat stays open for replies before the day-3 decision.
  windowHours: 72,

  // The short note that can go with "Interested".
  noteMaxLength: 140,

  // In a man-woman pair the woman writes first. Everywhere else (two women,
  // two men, anyone with a non-binary person) there is no such rule and the
  // person who showed interest first opens the chat. Set to false to use the
  // "first to show interest opens" rule for every pair.
  womanOpens: true,

  // The weekly drop goes out on Sunday at 20:00 India time (14:30 UTC, see
  // .github/workflows/weekly-drop.yml). A drop belongs to the Monday after it,
  // and its intros last until the next drop. So an intro expires this many
  // minutes after 00:00 UTC on its week's Monday: 6 days + 14 h 30 min.
  dropHourUtc: 14,
  dropMinuteUtc: 30,
  introExpiryMinutesAfterWeekStart: 6 * 24 * 60 + 14 * 60 + 30,
} as const;

export type ShortlistConfig = typeof SHORTLIST_CONFIG;
