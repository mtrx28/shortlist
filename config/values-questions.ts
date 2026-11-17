// The eight values questions. Each person answers all of them and marks exactly
// two answers as deal-breakers. Matching (a later milestone) compares answers
// and counts deal-breakers double. Ids are stored in the database, so never
// rename an id once people have answered; add a new question instead.

export type ValuesQuestion = {
  id: string;
  text: string;
  options: { id: string; label: string }[];
};

export const VALUES_QUESTIONS: ValuesQuestion[] = [
  {
    id: "weekend",
    text: "A perfect free Saturday is...",
    options: [
      { id: "outdoors", label: "Out and about, doing something active" },
      { id: "home", label: "At home with food, a book or a series" },
      { id: "friends", label: "With a big group of friends" },
      { id: "explore", label: "Trying a new place in the city" },
    ],
  },
  {
    id: "morning",
    text: "Are you more of a morning or a night person?",
    options: [
      { id: "early", label: "Early bird" },
      { id: "flexible", label: "Depends on the day" },
      { id: "night", label: "Night owl" },
    ],
  },
  {
    id: "family",
    text: "How close are you to your family?",
    options: [
      { id: "daily", label: "We talk every day" },
      { id: "weekly", label: "We catch up a few times a week" },
      { id: "independent", label: "Close, but I like my independence" },
    ],
  },
  {
    id: "money",
    text: "How do you think about money?",
    options: [
      { id: "saver", label: "Save first, spend later" },
      { id: "balanced", label: "A bit of both" },
      { id: "experiences", label: "Spend on experiences" },
    ],
  },
  {
    id: "career",
    text: "Where does work sit in your life right now?",
    options: [
      { id: "driven", label: "It comes first for now" },
      { id: "balance", label: "I want a real balance" },
      { id: "means", label: "It is a means to a life I enjoy" },
    ],
  },
  {
    id: "kids",
    text: "Do you want children one day?",
    options: [
      { id: "yes", label: "Yes" },
      { id: "maybe", label: "Maybe, not sure yet" },
      { id: "no", label: "No" },
    ],
  },
  {
    id: "disagreement",
    text: "When we disagree, I would rather...",
    options: [
      { id: "talk_now", label: "Talk it through right away" },
      { id: "cool_off", label: "Cool off first, then talk" },
      { id: "humour", label: "Lighten it up with humour" },
    ],
  },
  {
    id: "social",
    text: "How social are you?",
    options: [
      { id: "very", label: "Always up for plans" },
      { id: "some", label: "A few plans a week is plenty" },
      { id: "homebody", label: "I recharge at home" },
    ],
  },
];

export const DEAL_BREAKER_COUNT = 2;
