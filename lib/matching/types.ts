// The shapes the matching engine reads and writes. The engine is a pure
// function: it takes plain data in and gives plain data back, and never talks
// to the database. lib/matching/run-drop.ts does the loading and saving.

export type Gender = "woman" | "man" | "non_binary";
export type Intent = "serious" | "open_to_see" | "friendships_first";

// One answer per values question, plus whether the person marked it as a
// deal-breaker. Same shape as profiles.values_answers.
export type ValueAnswers = Record<
  string,
  { answer: string; dealBreaker: boolean }
>;

// A person as the engine sees them. Fields that are empty until onboarding is
// finished are nullable; such people are skipped, never matched.
export type MatchUser = {
  id: string;
  gender: Gender | null;
  interestedIn: Gender[];
  age: number; // whole years, worked out by the caller from the birth date
  city: string | null;
  intent: Intent | null;
  batchYear: number | null;
  interests: string[];
  values: ValueAnswers;
  paused: boolean;
  deleted: boolean;
  suspended: boolean;
  onboarded: boolean;
  isPlus: boolean; // Plus members get more intros
  repliesNum: number; // conversations the person replied in...
  repliesDen: number; // ...out of this many
};

// A person who passed the eligibility check: nothing is null any more.
export type Member = Omit<
  MatchUser,
  "gender" | "city" | "intent" | "batchYear"
> & {
  gender: Gender;
  city: string;
  intent: Intent;
  batchYear: number;
};

// What the engine needs to know about the past. All dates are the Monday that
// starts a week, as YYYY-MM-DD.
export type DropHistory = {
  weekStart: string; // the week being built
  // Earlier intros: the viewer was shown the candidate in that week.
  seen: { viewerId: string; candidateId: string; weekStart: string }[];
  // Blocks, either direction counts.
  blocks: { blockerId: string; blockedId: string }[];
  // Pairs who already have a live conversation (never shown again).
  connected?: { a: string; b: string }[];
};

export type SkipReason =
  "paused" | "deleted" | "suspended" | "onboarding_incomplete";

export type ZeroIntroReason =
  | "no_compatible_people" // nobody passed the hard filters
  | "already_seen" // the only people left were shown recently
  | "below_min_score" // people passed the filters but none were close enough
  | "candidates_full"; // good people exist but are in 5 shortlists already

// The six parts of a score, each between 0 and 1 (before weights).
export type ScoreBreakdown = {
  values: number;
  interests: number;
  lifeStage: number;
  intent: number;
  responsiveness: number;
  freshness: number;
  total: number; // weighted sum, between 0 and 1
};

export type IntroRow = {
  viewerId: string;
  candidateId: string;
  score: number;
  reasons: string[];
};

// Aggregate numbers only: nothing here identifies a person.
export type DropStats = {
  seed: string;
  weekStart: string;
  usersConsidered: number;
  usersEligible: number;
  skipped: Record<SkipReason, number>;
  introsCreated: number;
  usersWithIntros: number;
  usersWithZeroIntros: number;
  shareWithAtLeastOneIntro: number; // 0 to 1, of eligible users
  zeroIntroReasons: Record<ZeroIntroReason, number>;
  // How many shortlists each eligible person appears in (0 for never).
  shortlistAppearances: { max: number; min: number; mean: number };
};

export type DropResult = { intros: IntroRow[]; stats: DropStats };
