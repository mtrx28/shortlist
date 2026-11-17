// Profile prompts. Each person picks PROMPT_COUNT of these and answers in a
// sentence or two. Ids are stored in the database, so do not rename them.

export const PROMPTS = [
  { id: "weekend_plan", text: "My ideal Sunday morning looks like..." },
  { id: "geek_out", text: "I could talk for an hour about..." },
  { id: "green_flag", text: "A green flag I look for is..." },
  { id: "small_joy", text: "A small thing that makes my day is..." },
  { id: "first_date", text: "A first date I would actually enjoy is..." },
  { id: "moved_city", text: "The best thing about my city is..." },
  { id: "learning", text: "Something I am learning right now..." },
  { id: "unpopular", text: "My most harmless unpopular opinion is..." },
  { id: "comfort", text: "My comfort food is..." },
  { id: "together", text: "We will get along if..." },
] as const;

export const PROMPT_COUNT = 3;
export const PROMPT_ANSWER_MIN = 10;
export const PROMPT_ANSWER_MAX = 200;
