// The fixed lists the profile forms offer. Changing a list here changes the
// forms and the server-side validation together, because both read from it.

// Launch clusters. Matching works inside a city, so a free-text city would
// split the pool. "Gurugram / Noida" is one cluster on purpose.
export const CITIES = [
  "Bengaluru",
  "Pune",
  "Hyderabad",
  "Gurugram / Noida",
  "Chennai",
] as const;

export const GENDERS = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non_binary", label: "Non-binary" },
] as const;

export const INTENTS = [
  {
    value: "serious",
    label: "A serious relationship",
    hint: "I am looking for something long term.",
  },
  {
    value: "open_to_see",
    label: "Open to see where it goes",
    hint: "Serious is fine, but no rush.",
  },
  {
    value: "friendships_first",
    label: "Friendship first",
    hint: "I would like to get to know people slowly.",
  },
] as const;

// pH batches the launch is aimed at.
export const BATCH_YEARS = [2020, 2021, 2022, 2023] as const;

// A coarse, optional bucket. Never a college name.
export const COLLEGE_TIERS = [
  { value: "tier1", label: "Tier 1" },
  { value: "tier2", label: "Tier 2" },
  { value: "tier3", label: "Tier 3" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const INTERESTS = [
  "Cricket",
  "Football",
  "Running",
  "Gym",
  "Trekking",
  "Cycling",
  "Yoga",
  "Badminton",
  "Cooking",
  "Coffee",
  "Street food",
  "Baking",
  "Movies",
  "Stand-up comedy",
  "Live music",
  "Reading",
  "Board games",
  "Gaming",
  "Photography",
  "Travel",
  "Dancing",
  "Writing",
  "Pets",
  "Startups",
] as const;

export const MIN_INTERESTS = 3;
export const MAX_INTERESTS = 8;

export type Gender = (typeof GENDERS)[number]["value"];
export type IntentValue = (typeof INTENTS)[number]["value"];
