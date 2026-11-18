// The rules for chats: the reply window, when the day-3 decision opens, the
// message limits and the kind closing notes. Like config/shortlist.ts, the
// numbers live here and are passed to the database functions by the server,
// so there is one place to change them. (The 72 hour window itself is
// SHORTLIST_CONFIG.windowHours, set when the chat opens.)

export const CONVERSATION_CONFIG = {
  // "Day 3" of a 72 hour window starts at hour 48. From then on, once BOTH
  // people have written at least once, each person is asked to Keep or Close.
  // Before that, they simply chat.
  decisionOpensAfterHours: 48,

  // Someone who still owes the first message (the opener) or the first reply
  // (the other person) gets a gentle in-app reminder from hour 48.
  nudgeAfterHours: 48,

  // Message limits.
  messageMaxLength: 1000,
  // The opener may write this many messages before the other person has
  // replied once. It stops a one-sided flood.
  maxMessagesBeforeReply: 3,

  // Sending speed per person, counted over all their chats. Simple on
  // purpose: the database counts that person's recent messages.
  rateLimitPerMinute: 8,
  rateLimitPerHour: 120,

  // How the poll fallback behaves when realtime is not working (milliseconds).
  pollFastMs: 4000, // realtime is down
  pollSlowMs: 20000, // realtime is up: only a safety net

  // How long ended chats stay in the list.
  endedChatsVisibleDays: 14,
} as const;

// Kind closing notes. The person who closes picks one; the other person sees
// only this text. They are written so nobody is blamed. The id is what the
// form sends; the text is looked up here on the server, so nobody can send
// their own words through the "close kindly" door.
export const CLOSE_TEMPLATES = [
  {
    id: "thanks",
    label: "Thank you, I wish you well",
    text: "Thank you for chatting with me. I do not think we are a match, and I wish you well.",
  },
  {
    id: "step_back",
    label: "I am going to step back",
    text: "I enjoyed talking, but I am going to step back from this chat. Take care.",
  },
  {
    id: "not_ready",
    label: "I am not ready right now",
    text: "I realised I am not ready to keep a chat going right now. Thank you for your time.",
  },
  {
    id: "different_things",
    label: "We want different things",
    text: "It was nice getting to know you. I do not think we are looking for the same thing. Best wishes.",
  },
] as const;

export type CloseTemplateId = (typeof CLOSE_TEMPLATES)[number]["id"];

export function closeTemplateText(id: string): string | null {
  return CLOSE_TEMPLATES.find((t) => t.id === id)?.text ?? null;
}

// Short safety reminders shown on a kept chat (before anyone meets).
export const SAFE_MEET_TIPS = [
  "Meet in a public place the first few times, and tell a friend where you are going.",
  "Keep your phone number and address private until you trust the person.",
  "Never send money, whatever the reason. Report anyone who asks.",
] as const;
