import { createHash } from "node:crypto";
import { INTERESTS } from "@/config/profile-options";
import { PROMPTS } from "@/config/prompts";
import {
  DEAL_BREAKER_COUNT,
  VALUES_QUESTIONS,
} from "@/config/values-questions";
import { demoEmail } from "./guard";

// The invented people behind the demo logins. Everything here is made up:
// names, jobs and answers are not real people. The generator is deterministic
// (same input, same output) so running the seed twice gives the same profiles.

type Gender = "woman" | "man" | "non_binary";
type Intent = "serious" | "open_to_see" | "friendships_first";
type ElitmusStatus = "none" | "pending" | "verified";

export type DemoProfile = {
  handle: string; // the part before @ in the email
  email: string;
  displayName: string;
  dob: string; // YYYY-MM-DD
  gender: Gender;
  interestedIn: Gender[];
  city: string;
  intent: Intent;
  batchYear: number;
  collegeTier: "tier1" | "tier2" | "tier3" | "prefer_not_to_say";
  occupation: string;
  valuesAnswers: Record<string, { answer: string; dealBreaker: boolean }>;
  bioPrompts: { id: string; answer: string }[];
  interests: string[];
  elitmusStatus: ElitmusStatus;
  phId: string | null; // a fake demo ID; only its keyed hash is stored
  paused: boolean;
  role: "user" | "admin";
};

type CastMember = Pick<
  DemoProfile,
  | "displayName"
  | "dob"
  | "gender"
  | "city"
  | "intent"
  | "batchYear"
  | "collegeTier"
  | "occupation"
  | "elitmusStatus"
> & { handle: string };

// 19 people across four cities, plus one admin. Bengaluru has the most so a
// weekly drop there has a real pool; Gurugram is thin on purpose.
const CAST: CastMember[] = [
  // Bengaluru
  c(
    "priya",
    "Priya Raman",
    "1999-03-12",
    "woman",
    "Bengaluru",
    "serious",
    2021,
    "tier2",
    "Software engineer",
    "verified",
  ),
  c(
    "ananya",
    "Ananya Hegde",
    "2000-07-21",
    "woman",
    "Bengaluru",
    "open_to_see",
    2022,
    "tier2",
    "Data analyst",
    "verified",
  ),
  c(
    "divya",
    "Divya Nair",
    "1998-11-02",
    "woman",
    "Bengaluru",
    "friendships_first",
    2020,
    "tier3",
    "QA engineer",
    "pending",
  ),
  c(
    "rohan",
    "Rohan Gupta",
    "1999-01-17",
    "man",
    "Bengaluru",
    "serious",
    2021,
    "tier2",
    "Backend developer",
    "verified",
  ),
  c(
    "karthik",
    "Karthik Subramanian",
    "2000-05-09",
    "man",
    "Bengaluru",
    "open_to_see",
    2022,
    "tier3",
    "Support engineer",
    "none",
  ),
  c(
    "varun",
    "Varun Iyer",
    "2000-02-23",
    "man",
    "Bengaluru",
    "open_to_see",
    2022,
    "tier1",
    "Product analyst",
    "verified",
  ),
  c(
    "nikhil",
    "Nikhil Menon",
    "1998-09-08",
    "man",
    "Bengaluru",
    "serious",
    2020,
    "tier2",
    "Associate consultant",
    "verified",
  ),
  // Pune
  c(
    "meera",
    "Meera Kulkarni",
    "1999-09-30",
    "woman",
    "Pune",
    "serious",
    2021,
    "tier2",
    "Business analyst",
    "verified",
  ),
  c(
    "sneha",
    "Sneha Patil",
    "2001-02-14",
    "woman",
    "Pune",
    "open_to_see",
    2023,
    "tier3",
    "Operations executive",
    "verified",
  ),
  c(
    "tanvi",
    "Tanvi Shah",
    "2000-04-05",
    "woman",
    "Pune",
    "serious",
    2022,
    "tier2",
    "UX designer",
    "verified",
  ),
  c(
    "arjun",
    "Arjun Deshmukh",
    "1998-06-25",
    "man",
    "Pune",
    "serious",
    2020,
    "tier2",
    "Software engineer",
    "verified",
  ),
  c(
    "siddharth",
    "Siddharth Joshi",
    "2000-12-03",
    "man",
    "Pune",
    "friendships_first",
    2022,
    "tier3",
    "Finance associate",
    "none",
  ),
  // Hyderabad
  c(
    "neha",
    "Neha Reddy",
    "2000-08-08",
    "woman",
    "Hyderabad",
    "serious",
    2022,
    "tier2",
    "Systems engineer",
    "none",
  ),
  c(
    "lakshmi",
    "Lakshmi Prasad",
    "1999-10-15",
    "woman",
    "Hyderabad",
    "open_to_see",
    2021,
    "tier3",
    "Technical writer",
    "pending",
  ),
  c(
    "vikram",
    "Vikram Rao",
    "1999-03-28",
    "man",
    "Hyderabad",
    "serious",
    2021,
    "tier2",
    "Cloud engineer",
    "verified",
  ),
  c(
    "sai",
    "Sai Teja",
    "2001-01-06",
    "man",
    "Hyderabad",
    "open_to_see",
    2023,
    "tier3",
    "Junior developer",
    "verified",
  ),
  // Gurugram / Noida
  c(
    "isha",
    "Isha Malhotra",
    "2000-06-11",
    "woman",
    "Gurugram / Noida",
    "serious",
    2022,
    "tier1",
    "Marketing associate",
    "verified",
  ),
  c(
    "rahul",
    "Rahul Verma",
    "1999-08-02",
    "man",
    "Gurugram / Noida",
    "serious",
    2021,
    "tier2",
    "Consultant",
    "verified",
  ),
  c(
    "aman",
    "Aman Chauhan",
    "2000-10-27",
    "man",
    "Gurugram / Noida",
    "open_to_see",
    2022,
    "tier3",
    "Sales engineer",
    "pending",
  ),
  // Demo admin: kept out of matching by pausing the profile.
  c(
    "admin",
    "Asha Admin",
    "1997-05-20",
    "woman",
    "Bengaluru",
    "serious",
    2020,
    "prefer_not_to_say",
    "Community lead",
    "none",
  ),
];

function c(
  handle: string,
  displayName: string,
  dob: string,
  gender: Gender,
  city: string,
  intent: Intent,
  batchYear: number,
  collegeTier: CastMember["collegeTier"],
  occupation: string,
  elitmusStatus: ElitmusStatus,
): CastMember {
  return {
    handle,
    displayName,
    dob,
    gender,
    city,
    intent,
    batchYear,
    collegeTier,
    occupation,
    elitmusStatus,
  };
}

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

// Seeded random numbers (mulberry32): same seed, same sequence.
export function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOne<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function pickMany<T>(rng: () => number, list: readonly T[], n: number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// A stable UUID made from a text key, so seeded rows keep the same id on every
// run (this is what makes the seed safe to repeat).
export function uuidFromKey(key: string): string {
  const h = createHash("sha1").update(`shortlist-demo:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Prompt answers: a few invented answers per prompt, picked per person.
// ---------------------------------------------------------------------------
const ANSWER_POOL: Record<string, string[]> = {
  weekend_plan: [
    "Filter coffee, the newspaper crossword and no alarm.",
    "A long walk before the city wakes up, then a big breakfast.",
    "Slow cooking something from my mother's recipe book.",
    "A cycling loop with friends and poha at the end of it.",
  ],
  geek_out: [
    "How cities decide where the roads go. I have strong opinions.",
    "Mechanical keyboards, sadly. I will bring snacks if you let me.",
    "Cricket stats and why the nineties matches felt different.",
    "Home espresso setups and the exact grind size for each bean.",
  ],
  green_flag: [
    "Someone who replies kindly even when they are busy.",
    "People who are nice to waiters and auto drivers.",
    "When you say what you want instead of making me guess.",
    "Being able to laugh at yourself in the first ten minutes.",
  ],
  small_joy: [
    "The first sip of tea when it finally rains.",
    "A song I forgot about coming on shuffle.",
    "Getting a seat by the window in the metro.",
    "A stranger's dog deciding I am a friend.",
  ],
  first_date: [
    "Filter coffee and a walk, no pressure to stay long.",
    "A small bookshop, then dosa somewhere nearby.",
    "Board games at a cafe, losing gracefully optional.",
    "A weekend market where we can wander and talk.",
  ],
  moved_city: [
    "Everyone is from somewhere else, so making friends is easy.",
    "The weather, and how every neighbourhood has its own tiffin place.",
    "Small cafes that stay open late and do not rush you.",
    "The trekking trails that are a short drive away.",
  ],
  learning: [
    "Swimming, properly this time, with an actual instructor.",
    "Basic Spanish. I can order food and apologise.",
    "How to bake bread that does not turn into a brick.",
    "Playing the guitar beyond the same four chords.",
  ],
  unpopular: [
    "Biryani is fine with or without potato. I said it.",
    "Mondays are the best day to start things.",
    "Rain is overrated when you commute by two-wheeler.",
    "Tea at midnight is a legitimate dinner.",
  ],
  comfort: [
    "Curd rice with pickle, no questions asked.",
    "Hot dal chawal with a spoon of ghee.",
    "Maggi with extra vegetables I pretend make it healthy.",
    "Anything my grandmother cooked, especially the paratha.",
  ],
  together: [
    "You are curious, you plan loosely and you text back eventually.",
    "You like evening walks and do not mind comfortable silences.",
    "You can be serious about the big things and silly about the rest.",
    "You are kind to people who cannot do anything for you.",
  ],
};

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export function buildDemoProfiles(): DemoProfile[] {
  return CAST.map((m, index) => {
    const rng = makeRng(m.handle);

    const valuesAnswers: DemoProfile["valuesAnswers"] = {};
    const dealBreakers = new Set(
      pickMany(
        rng,
        VALUES_QUESTIONS.map((q) => q.id),
        DEAL_BREAKER_COUNT,
      ),
    );
    for (const q of VALUES_QUESTIONS) {
      valuesAnswers[q.id] = {
        answer: pickOne(rng, q.options).id,
        dealBreaker: dealBreakers.has(q.id),
      };
    }

    const bioPrompts = pickMany(rng, PROMPTS, 3).map((p) => ({
      id: p.id,
      answer: pickOne(rng, ANSWER_POOL[p.id]),
    }));

    const interestedIn: Gender[] =
      m.gender === "woman"
        ? ["man"]
        : m.gender === "man"
          ? ["woman"]
          : ["woman", "man"];

    return {
      handle: m.handle,
      email: demoEmail(m.handle),
      displayName: m.displayName,
      dob: m.dob,
      gender: m.gender,
      interestedIn,
      city: m.city,
      intent: m.intent,
      batchYear: m.batchYear,
      collegeTier: m.collegeTier,
      occupation: m.occupation,
      valuesAnswers,
      bioPrompts,
      interests: pickMany(rng, INTERESTS, 4),
      elitmusStatus: m.elitmusStatus,
      // Fake IDs: 8 letters/digits, which passes the pH ID format check.
      phId:
        m.elitmusStatus === "none"
          ? null
          : `DEMO${String(index + 1).padStart(4, "0")}`,
      paused: m.handle === "admin",
      role: m.handle === "admin" ? "admin" : "user",
    };
  });
}

// Up to two short reasons for showing two people to each other. This is a
// simple stand-in; the real matching engine (a later milestone) will write
// these itself.
export function explainMatch(a: DemoProfile, b: DemoProfile): string[] {
  const reasons: string[] = [];
  for (const q of VALUES_QUESTIONS) {
    const x = a.valuesAnswers[q.id];
    const y = b.valuesAnswers[q.id];
    if (x.answer === y.answer && reasons.length < 1) {
      const label = q.options.find((o) => o.id === x.answer)?.label;
      if (label) reasons.push(`You both answered "${label}" on: ${q.text}`);
    }
  }
  const shared = a.interests.filter((i) => b.interests.includes(i));
  if (shared.length > 0) {
    reasons.push(`You both like ${shared.slice(0, 2).join(" and ")}`);
  }
  if (reasons.length < 2 && Math.abs(a.batchYear - b.batchYear) <= 1) {
    reasons.push("Similar pH batches");
  }
  if (reasons.length === 0) reasons.push(`You are both in ${a.city}`);
  return reasons.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Scenario rows: drops, intros, conversations, messages, a report, events.
// They are written straight into the tables (the app code that creates them
// arrives in later milestones) so every screen has something to show.
// ---------------------------------------------------------------------------

export type DemoDrop = {
  id: string;
  week_start: string;
  run_at: string;
  stats: Record<string, unknown>;
};

export type DemoIntro = {
  id: string;
  drop_id: string;
  viewer_id: string;
  candidate_id: string;
  score: number;
  reasons: string[];
  status: "new" | "passed" | "interested" | "expired";
  note: string | null;
  created_at: string;
};

export type DemoConversation = {
  id: string;
  user_a: string;
  user_b: string;
  opener_id: string;
  origin_intro_a: string | null;
  origin_intro_b: string | null;
  status: "open" | "kept" | "closed" | "expired";
  opened_at: string;
  window_ends_at: string;
  a_decision: "keep" | "close" | null;
  b_decision: "keep" | "close" | null;
  closed_reason: string | null;
};

export type DemoMessage = {
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type DemoReport = {
  id: string;
  reporter_id: string;
  target_id: string;
  reason: "inappropriate_content";
  details: string;
  status: "open";
  created_at: string;
};

export type DemoEvent = {
  user_id: string;
  name: string;
  props: Record<string, string | number | boolean>;
  at: string;
};

export type DemoScenario = {
  drops: DemoDrop[];
  intros: DemoIntro[];
  conversations: DemoConversation[];
  messages: DemoMessage[];
  reports: DemoReport[];
  events: DemoEvent[];
};

const WINDOW_HOURS = 72;
const HOUR = 3600 * 1000;

function hoursAgo(now: Date, h: number): string {
  return new Date(now.getTime() - h * HOUR).toISOString();
}

// Monday (UTC) of the week containing `date`, as YYYY-MM-DD.
export function weekStart(date: Date, weeksBack = 0): string {
  const day = date.getUTCDay(); // 0 = Sunday
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      (mondayOffset + weeksBack * 7) * 24 * HOUR,
  );
  return monday.toISOString().slice(0, 10);
}

type IntroSpec = [
  week: "last" | "this",
  viewer: string,
  candidate: string,
  status: DemoIntro["status"],
  note?: string,
];

// Last week's drop is history: the interested pairs became conversations.
// This week's drop is what people see now.
const INTRO_SPECS: IntroSpec[] = [
  // Pairs that opened conversations (interested both ways).
  ["last", "priya", "rohan", "interested"],
  ["last", "rohan", "priya", "interested"],
  [
    "last",
    "sneha",
    "arjun",
    "interested",
    "Hi! I saw we both like early treks. Coffee chat first?",
  ],
  ["last", "arjun", "sneha", "interested"],
  ["last", "isha", "rahul", "interested"],
  ["last", "rahul", "isha", "interested"],
  ["last", "ananya", "karthik", "interested"],
  ["last", "karthik", "ananya", "interested"],
  ["last", "divya", "varun", "interested"],
  ["last", "varun", "divya", "interested"],
  ["last", "lakshmi", "sai", "interested"],
  ["last", "sai", "lakshmi", "interested"],
  ["last", "ananya", "nikhil", "passed"],
  // This week. Priya has a full shortlist.
  ["this", "priya", "karthik", "new"],
  ["this", "priya", "varun", "new"],
  ["this", "priya", "nikhil", "new"],
  // Arjun: Meera has already shown interest (woman-first rule), Tanvi is new.
  ["this", "arjun", "meera", "new"],
  ["this", "arjun", "tanvi", "new"],
  [
    "this",
    "meera",
    "arjun",
    "interested",
    "Your answers on weekends and family felt very close to mine.",
  ],
  ["this", "meera", "siddharth", "new"],
  ["this", "tanvi", "arjun", "new"],
  ["this", "vikram", "lakshmi", "new"],
];

type ConvoSpec = {
  key: string;
  a: string;
  b: string;
  opener: string;
  status: DemoConversation["status"];
  openedHoursAgo: number;
  aDecision?: "keep" | "close";
  bDecision?: "keep" | "close";
  closedReason?: string;
  // [who, hours ago, text]
  messages: [string, number, string][];
};

const CONVO_SPECS: ConvoSpec[] = [
  {
    // Mid-conversation, plenty of time left.
    key: "priya-rohan",
    a: "priya",
    b: "rohan",
    opener: "priya",
    status: "open",
    openedHoursAgo: 30,
    messages: [
      [
        "priya",
        29.5,
        "Hi Rohan! Your answer about slow Sundays made me smile. What does yours look like?",
      ],
      [
        "rohan",
        27,
        "Hey Priya! Filter coffee, a long run and then doing nothing guilt-free. You?",
      ],
      [
        "priya",
        26.5,
        "Same energy, minus the run. I do the nothing part very well.",
      ],
      [
        "rohan",
        24,
        "Ha. Any good coffee place in Indiranagar you would recommend?",
      ],
      [
        "priya",
        20,
        "There is a tiny one behind the metro station. I will send the name.",
      ],
      [
        "rohan",
        19,
        "Perfect. Also I saw you like trekking. Done any of the Western Ghats ones?",
      ],
    ],
  },
  {
    // Close to the end of the 72 hour window, nobody has decided yet.
    key: "sneha-arjun",
    a: "sneha",
    b: "arjun",
    opener: "sneha",
    status: "open",
    openedHoursAgo: 68,
    messages: [
      [
        "sneha",
        67.5,
        "Hi Arjun! Quick question: Sinhagad at sunrise or a lazy cafe morning?",
      ],
      ["arjun", 60, "Sunrise, but only if there is tea at the top. You?"],
      ["sneha", 59, "There is always tea at the top. Deal."],
      [
        "arjun",
        45,
        "Sorry for the slow reply, work was a lot. Still keen to chat!",
      ],
    ],
  },
  {
    // A conversation that was kept by both people.
    key: "isha-rahul",
    a: "isha",
    b: "rahul",
    opener: "isha",
    status: "kept",
    openedHoursAgo: 120,
    aDecision: "keep",
    bDecision: "keep",
    messages: [
      ["isha", 119, "Hi Rahul! I saw you are into board games. Favourite one?"],
      ["rahul", 116, "Catan, though I lose at it a lot. Do you play?"],
      [
        "isha",
        110,
        "Ticket to Ride mostly. We could settle this over a game sometime.",
      ],
      ["rahul", 100, "I would like that. Weekend coffee near Cyber Hub?"],
      ["isha", 90, "Saturday afternoon works for me."],
      ["rahul", 52, "Saturday it is. I will book a table at a public cafe."],
    ],
  },
  {
    // Closed kindly by one person.
    key: "ananya-karthik",
    a: "ananya",
    b: "karthik",
    opener: "ananya",
    status: "closed",
    openedHoursAgo: 144,
    aDecision: "close",
    closedReason: "Closed kindly: we did not click, wishing them well.",
    messages: [
      ["ananya", 143, "Hi Karthik! What got you into data work?"],
      [
        "karthik",
        138,
        "Support tickets, honestly. I started automating the boring ones.",
      ],
      [
        "ananya",
        120,
        "Nice. I think we are after slightly different things, but I enjoyed this.",
      ],
    ],
  },
  {
    // Ran out of time: the opener wrote, the other person never replied.
    key: "divya-varun",
    a: "divya",
    b: "varun",
    opener: "divya",
    status: "expired",
    openedHoursAgo: 100,
    closedReason: "No reply within the window.",
    messages: [
      [
        "divya",
        99,
        "Hi Varun! Do you also dislike meetings that could be emails?",
      ],
    ],
  },
  {
    key: "lakshmi-sai",
    a: "lakshmi",
    b: "sai",
    opener: "lakshmi",
    status: "open",
    openedHoursAgo: 12,
    messages: [
      ["lakshmi", 11.5, "Hi Sai! I saw you cook. What is your signature dish?"],
      [
        "sai",
        9,
        "Egg curry that I am not allowed to share the recipe for. Yours?",
      ],
      ["lakshmi", 8, "Pesarattu. Fully serious about it."],
    ],
  },
];

export function buildScenario(
  profiles: DemoProfile[],
  idOf: Record<string, string>, // handle -> auth user id
  now: Date,
): DemoScenario {
  const byHandle = new Map(profiles.map((p) => [p.handle, p]));
  const profile = (handle: string) => {
    const p = byHandle.get(handle);
    if (!p) throw new Error(`Unknown demo user: ${handle}`);
    return p;
  };
  const id = (handle: string) => {
    const v = idOf[handle];
    if (!v) throw new Error(`No id for demo user: ${handle}`);
    return v;
  };

  const drops: DemoDrop[] = [
    {
      id: uuidFromKey("drop:last"),
      week_start: weekStart(now, 1),
      run_at: hoursAgo(now, 7 * 24),
      stats: { demo: true },
    },
    {
      id: uuidFromKey("drop:this"),
      week_start: weekStart(now, 0),
      run_at: hoursAgo(now, 6),
      stats: { demo: true },
    },
  ];
  const dropId = { last: drops[0].id, this: drops[1].id };

  const introKey = (week: string, viewer: string, candidate: string) =>
    uuidFromKey(`intro:${week}:${viewer}:${candidate}`);

  const intros: DemoIntro[] = INTRO_SPECS.map(
    ([week, viewer, candidate, status, note]) => {
      const rng = makeRng(`${viewer}>${candidate}`);
      return {
        id: introKey(week, viewer, candidate),
        drop_id: dropId[week],
        viewer_id: id(viewer),
        candidate_id: id(candidate),
        score: Math.round((0.55 + rng() * 0.4) * 100) / 100,
        reasons: explainMatch(profile(viewer), profile(candidate)),
        status,
        note: note ?? null,
        created_at: hoursAgo(now, week === "this" ? 6 : 7 * 24),
      };
    },
  );

  const conversations: DemoConversation[] = [];
  const messages: DemoMessage[] = [];
  const events: DemoEvent[] = [];

  for (const spec of CONVO_SPECS) {
    const conversationId = uuidFromKey(`conversation:${spec.key}`);
    const opened = now.getTime() - spec.openedHoursAgo * HOUR;
    conversations.push({
      id: conversationId,
      user_a: id(spec.a),
      user_b: id(spec.b),
      opener_id: id(spec.opener),
      origin_intro_a: introKey("last", spec.a, spec.b),
      origin_intro_b: introKey("last", spec.b, spec.a),
      status: spec.status,
      opened_at: new Date(opened).toISOString(),
      window_ends_at: new Date(opened + WINDOW_HOURS * HOUR).toISOString(),
      a_decision: spec.aDecision ?? null,
      b_decision: spec.bDecision ?? null,
      closed_reason: spec.closedReason ?? null,
    });
    for (const [who, h, body] of spec.messages) {
      messages.push({
        conversation_id: conversationId,
        sender_id: id(who),
        body,
        created_at: hoursAgo(now, h),
      });
    }
    events.push({
      user_id: id(spec.opener),
      name: "chat_opened",
      props: { demo: true },
      at: new Date(opened).toISOString(),
    });
    if (spec.status === "kept") {
      events.push({
        user_id: id(spec.a),
        name: "kept",
        props: { demo: true },
        at: hoursAgo(now, 50),
      });
    }
    if (spec.status === "closed") {
      events.push({
        user_id: id(spec.a),
        name: "closed",
        props: { demo: true },
        at: hoursAgo(now, 118),
      });
    }
  }

  // One open report so the later admin queue has something in it.
  const reports: DemoReport[] = [
    {
      id: uuidFromKey("report:ananya-nikhil"),
      reporter_id: id("ananya"),
      target_id: id("nikhil"),
      reason: "inappropriate_content",
      details:
        "Demo report: the second photo felt off-topic for a dating profile.",
      status: "open",
      created_at: hoursAgo(now, 20),
    },
  ];
  events.push({
    user_id: id("ananya"),
    name: "reported",
    props: { demo: true },
    at: hoursAgo(now, 20),
  });

  // Signup, onboarding and verification events, spread over the past weeks so
  // the admin counters are not all the same moment.
  profiles.forEach((p, i) => {
    const days = 28 - i;
    events.push({
      user_id: id(p.handle),
      name: "signup",
      props: { demo: true },
      at: hoursAgo(now, days * 24),
    });
    events.push({
      user_id: id(p.handle),
      name: "onboarding_completed",
      props: { demo: true },
      at: hoursAgo(now, days * 24 - 1),
    });
    if (p.elitmusStatus !== "none") {
      events.push({
        user_id: id(p.handle),
        name: "elitmus_verification_requested",
        props: { demo: true, status: p.elitmusStatus },
        at: hoursAgo(now, days * 24 - 2),
      });
    }
  });

  return { drops, intros, conversations, messages, reports, events };
}

// The four logins the owner shares with evaluators.
export const PUBLISHED_LOGINS = [
  {
    handle: "priya",
    role: "Woman, Bengaluru: a full shortlist and a chat in progress",
  },
  {
    handle: "arjun",
    role: "Man, Pune: a chat close to its 72 hour limit, and a woman who has already shown interest",
  },
  {
    handle: "neha",
    role: "New member, Hyderabad: finished profile, nothing yet (the empty state)",
  },
  { handle: "admin", role: "Admin: verification approvals and the dashboard" },
] as const;
