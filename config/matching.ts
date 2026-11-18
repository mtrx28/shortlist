// Every number the matching engine uses lives here, so the rules can be
// tuned (or A/B tested) without touching the algorithm. The numbers are my
// assumptions, not research results. See lib/matching/ for how they are used.

export type MatchingConfig = {
  // --- How many intros each person gets -----------------------------------
  introsFree: number; // free members get 3 a week
  introsPlus: number; // Plus members get 5 (3 + 2 extra)

  // --- Fairness ------------------------------------------------------------
  // No one may appear in more than this many shortlists in one drop. It stops
  // a few popular people from taking everyone's attention.
  maxShortlistsPerCandidate: number;
  // A person you were shown in the last N drops is not shown to you again.
  noRepeatWeeks: number;

  // --- Hard filters --------------------------------------------------------
  // There is no age-range setting in profiles yet, so both people must be
  // within this many years of each other. It is symmetric, so it is mutual.
  maxAgeGapYears: number;

  // --- Score ---------------------------------------------------------------
  // The six weights add up to 1, so a perfect match scores 1.
  weights: {
    values: number; // same answers to the 8 values questions
    interests: number; // overlap of interest tags
    lifeStage: number; // pH batches close together
    intent: number; // what each person is looking for
    responsiveness: number; // how often the person replies (a band)
    freshness: number; // bonus for people who were rarely shown lately
  };
  // A question counts this many times when either person marked it as a
  // deal-breaker (a normal question counts once).
  dealBreakerWeight: number;
  // Batch years apart that still earn life-stage credit. 0 apart = full
  // credit, then it falls in equal steps to zero just past this gap.
  lifeStageMaxGap: number;
  // How compatible two intents are, from 0 (not at all) to 1 (identical).
  // Friendship-first people are open to anyone, so no pair is at 0, but a
  // serious person and a friendship-first person only score a little.
  // The key is the two intents sorted and joined with "+".
  intentScores: Record<string, number>;
  // Reply-rate bands. Below minChatsForReplyRate chats we do not know yet and
  // use the neutral value. Otherwise the person's reply rate picks a band.
  minChatsForReplyRate: number;
  replyBands: { atLeast: number; value: number }[]; // highest first
  neutralResponsiveness: number;
  // Freshness: 1 for someone never shown in the window, falling in equal
  // steps to 0 for someone shown this many times.
  freshnessFullAfterShown: number;

  // A pair scoring below this is never shown, even if the person would
  // otherwise get fewer intros. We would rather show fewer than pad the list.
  minScore: number;

  // Number of reasons written for each intro.
  reasonsPerIntro: number;
};

export const MATCHING_CONFIG: MatchingConfig = {
  introsFree: 3,
  introsPlus: 5,
  maxShortlistsPerCandidate: 5,
  noRepeatWeeks: 8,
  maxAgeGapYears: 6,

  weights: {
    values: 0.35,
    interests: 0.2,
    lifeStage: 0.15,
    intent: 0.1,
    responsiveness: 0.1,
    freshness: 0.1,
  },
  dealBreakerWeight: 2,
  lifeStageMaxGap: 2,
  intentScores: {
    "serious+serious": 1,
    "open_to_see+open_to_see": 1,
    "friendships_first+friendships_first": 1,
    "open_to_see+serious": 0.7,
    "friendships_first+open_to_see": 0.6,
    "friendships_first+serious": 0.3,
  },
  minChatsForReplyRate: 5,
  replyBands: [
    { atLeast: 0.7, value: 1 },
    { atLeast: 0.4, value: 0.6 },
    { atLeast: 0, value: 0.2 },
  ],
  neutralResponsiveness: 0.5,
  freshnessFullAfterShown: 10,

  minScore: 0.3,
  reasonsPerIntro: 2,
};

// Plain-language names for each values question, used in the "why we matched"
// reasons. They say WHAT you agree on, never which answer the other person
// gave. Every question id in config/values-questions.ts needs a line here
// (a test checks it).
export const VALUE_TOPICS: Record<string, string> = {
  weekend: "how you like to spend a free Saturday",
  morning: "mornings versus late nights",
  family: "how close you stay to family",
  money: "how you think about money",
  career: "where work sits in life",
  kids: "wanting children",
  disagreement: "how you handle disagreements",
  social: "how social you like to be",
};
