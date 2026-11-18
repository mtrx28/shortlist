import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONVERSATION_CONFIG } from "@/config/conversation";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import {
  nextState,
  replyRateDeltas,
  type ChatDecision,
  type Conv,
  type ConvEvent,
} from "@/lib/conversation/state";
import { errorCode, publicCode } from "@/lib/conversation/service";

// send_message(), record_decision(), expire_conversations(), the reply-rate
// update, get_conversation(), the unread marker and the row level security of
// the chat tables, against a real Postgres (PGlite). PGlite runs one
// connection, so "at the same time" is simulated by running calls one after
// another in different orders; real parallel locking is NOT tested here.

const root = process.cwd();
let db: PGlite;

const NOW = new Date("2026-11-18T10:00:00Z");
const HOUR = 3600 * 1000;
const iso = (d: Date) => d.toISOString();
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

async function createUser(name: string) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [
      id,
      `${name}-${id}@example.com`,
      JSON.stringify({
        display_name: name,
        dob: "1998-03-14",
        accepted_terms: "true",
        accepted_privacy: "true",
        consent_version: "test-1",
      }),
    ],
  );
  await db.query(
    `update public.profiles set onboarding_completed_at = now() where id = $1`,
    [id],
  );
  return id;
}

type ChatSpec = {
  a: string;
  b: string;
  opener: string;
  status?: string;
  openedAgoH?: number;
  windowH?: number;
  aDecision?: ChatDecision | null;
  bDecision?: ChatDecision | null;
};

async function addChat(s: ChatSpec) {
  const opened = ago(s.openedAgoH ?? 1);
  const ends = new Date(opened.getTime() + (s.windowH ?? 72) * HOUR);
  const r = await db.query<{ id: string }>(
    `insert into public.conversations
       (user_a, user_b, opener_id, status, opened_at, window_ends_at, a_decision, b_decision)
     values ($1, $2, $3, $4::public.conversation_status, $5, $6,
             $7::public.decision, $8::public.decision) returning id`,
    [
      s.a,
      s.b,
      s.opener,
      s.status ?? "open",
      iso(opened),
      iso(ends),
      s.aDecision ?? null,
      s.bDecision ?? null,
    ],
  );
  return r.rows[0].id;
}

// Writes messages straight into the table (as the database owner), spread
// over the chat's first hours so they never count toward a rate limit.
async function addMessages(conv: string, sender: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.query(
      `insert into public.messages (conversation_id, sender_id, body, created_at)
       values ($1, $2, $3, $4)`,
      [conv, sender, `hello ${i}`, iso(ago(200 - i))],
    );
  }
}

async function actAs<T>(
  who: string | "service" | "anon",
  fn: () => Promise<T>,
): Promise<T> {
  const role =
    who === "service"
      ? "service_role"
      : who === "anon"
        ? "anon"
        : "authenticated";
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    who === "service" || who === "anon" ? "" : who,
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

type Json = Record<string, unknown>;

async function send(
  sender: string,
  conv: string,
  body: string,
  o: {
    now?: Date;
    flagged?: boolean;
    perMinute?: number;
    perHour?: number;
    maxLength?: number;
  } = {},
): Promise<Json> {
  const r = await actAs("service", () =>
    db.query<{ r: Json }>(
      `select public.send_message($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9) as r`,
      [
        sender,
        conv,
        body,
        o.flagged ?? false,
        iso(o.now ?? NOW),
        o.maxLength ?? CONVERSATION_CONFIG.messageMaxLength,
        CONVERSATION_CONFIG.maxMessagesBeforeReply,
        o.perMinute ?? CONVERSATION_CONFIG.rateLimitPerMinute,
        o.perHour ?? CONVERSATION_CONFIG.rateLimitPerHour,
      ],
    ),
  );
  return r.rows[0].r;
}

async function decide(
  user: string,
  conv: string,
  decision: string,
  o: { note?: string | null; now?: Date } = {},
): Promise<Json> {
  const r = await actAs("service", () =>
    db.query<{ r: Json }>(
      `select public.record_decision($1, $2, $3, $4, $5::timestamptz, $6) as r`,
      [
        user,
        conv,
        decision,
        o.note === undefined ? "NOTE" : o.note,
        iso(o.now ?? NOW),
        CONVERSATION_CONFIG.decisionOpensAfterHours,
      ],
    ),
  );
  return r.rows[0].r;
}

async function expire(now: Date = NOW): Promise<Json> {
  const r = await actAs("service", () =>
    db.query<{ r: Json }>(
      `select public.expire_conversations($1::timestamptz, 500) as r`,
      [iso(now)],
    ),
  );
  return r.rows[0].r;
}

// The short code a database error carries, or "ok" when nothing was raised.
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (e) {
    const code = errorCode(e instanceof Error ? e.message : String(e));
    return code ? publicCode(code) : `OTHER: ${String(e)}`;
  }
}

const row = async (id: string) =>
  (
    await db.query<{
      status: string;
      a_decision: string | null;
      b_decision: string | null;
      closed_by: string | null;
      closed_reason: string | null;
      closed_at: string | null;
    }>(
      `select status, a_decision, b_decision, closed_by, closed_reason, closed_at
         from public.conversations where id = $1`,
      [id],
    )
  ).rows[0];

const sentCount = async (conv: string, sender: string) =>
  Number(
    (
      await db.query<{ n: string }>(
        `select count(*) as n from public.messages where conversation_id = $1 and sender_id = $2`,
        [conv, sender],
      )
    ).rows[0].n,
  );

const rate = async (id: string) =>
  (
    await db.query<{ num: number; den: number }>(
      `select reply_rate_num as num, reply_rate_den as den from public.profiles where id = $1`,
      [id],
    )
  ).rows[0];

// Two people and an open chat, with the opener and the others set up.
async function pair() {
  const opener = await createUser("opener");
  const other = await createUser("other");
  return { opener, other };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(root, "tests/rls/bootstrap.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// TypeScript nextState() and the SQL functions give the same answers
// ---------------------------------------------------------------------------
type State = {
  name: string;
  status?: string;
  openedAgoH: number;
  sentOpener: number;
  sentOther: number;
  openerDecision?: ChatDecision;
  otherDecision?: ChatDecision;
  blocked?: boolean;
};

const STATES: State[] = [
  { name: "fresh, nobody wrote", openedAgoH: 1, sentOpener: 0, sentOther: 0 },
  { name: "opener wrote once", openedAgoH: 10, sentOpener: 1, sentOther: 0 },
  {
    name: "opener used the messages before a reply",
    openedAgoH: 10,
    sentOpener: CONVERSATION_CONFIG.maxMessagesBeforeReply,
    sentOther: 0,
  },
  { name: "both wrote, day 2", openedAgoH: 30, sentOpener: 1, sentOther: 1 },
  {
    name: "both wrote, day 3 opened",
    openedAgoH: 49,
    sentOpener: 2,
    sentOther: 1,
  },
  {
    name: "day 3, opener already said keep",
    openedAgoH: 49,
    sentOpener: 1,
    sentOther: 1,
    openerDecision: "keep",
  },
  {
    name: "day 3, other already said keep",
    openedAgoH: 49,
    sentOpener: 1,
    sentOther: 1,
    otherDecision: "keep",
  },
  {
    name: "window over, both wrote",
    openedAgoH: 73,
    sentOpener: 1,
    sentOther: 1,
  },
  {
    name: "window over, nobody wrote",
    openedAgoH: 73,
    sentOpener: 0,
    sentOther: 0,
  },
  {
    name: "window over, only opener wrote",
    openedAgoH: 73,
    sentOpener: 1,
    sentOther: 0,
  },
  {
    name: "kept",
    status: "kept",
    openedAgoH: 100,
    sentOpener: 2,
    sentOther: 2,
    openerDecision: "keep",
    otherDecision: "keep",
  },
  {
    name: "closed",
    status: "closed",
    openedAgoH: 60,
    sentOpener: 1,
    sentOther: 1,
    otherDecision: "close",
  },
  {
    name: "expired",
    status: "expired",
    openedAgoH: 100,
    sentOpener: 1,
    sentOther: 0,
  },
  {
    name: "day 3 but blocked",
    openedAgoH: 49,
    sentOpener: 1,
    sentOther: 1,
    blocked: true,
  },
];

type Who = "opener" | "other" | "stranger";
type EventSpec =
  | { name: string; type: "message"; who: Who }
  | { name: string; type: "decide"; who: Who; decision: string }
  | { name: string; type: "tick" };

const EVENTS: EventSpec[] = [
  { name: "opener writes", type: "message", who: "opener" },
  { name: "other writes", type: "message", who: "other" },
  { name: "stranger writes", type: "message", who: "stranger" },
  { name: "opener keeps", type: "decide", who: "opener", decision: "keep" },
  { name: "other keeps", type: "decide", who: "other", decision: "keep" },
  { name: "opener closes", type: "decide", who: "opener", decision: "close" },
  { name: "other closes", type: "decide", who: "other", decision: "close" },
  { name: "stranger keeps", type: "decide", who: "stranger", decision: "keep" },
  { name: "bad decision", type: "decide", who: "opener", decision: "maybe" },
  { name: "expiry job", type: "tick" },
];

describe("TypeScript nextState and the SQL functions agree", () => {
  const cases: [string, State, EventSpec, number][] = [];
  let i = 0;
  for (const s of STATES) {
    for (const e of EVENTS) {
      cases.push([`${s.name} / ${e.name}`, s, e, i++]);
    }
  }

  it.each(cases)("%s", async (_name, s, e, index) => {
    const opener = await createUser("opener");
    const other = await createUser("other");
    const stranger = await createUser("stranger");
    // Put the opener in slot A or B alternately so a mix-up would show.
    const [a, b] = index % 2 === 0 ? [opener, other] : [other, opener];
    const status = s.status ?? "open";
    const chatId = await addChat({
      a,
      b,
      opener,
      status,
      openedAgoH: s.openedAgoH,
      aDecision: opener === a ? s.openerDecision : s.otherDecision,
      bDecision: opener === a ? s.otherDecision : s.openerDecision,
    });
    await addMessages(chatId, opener, s.sentOpener);
    await addMessages(chatId, other, s.sentOther);
    if (s.blocked) {
      await db.query(
        `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
        [other, opener],
      );
    }

    const before = await row(chatId);
    const conv: Conv = {
      status: status as Conv["status"],
      userA: a,
      userB: b,
      openerId: opener,
      openedAt: ago(s.openedAgoH),
      windowEndsAt: new Date(ago(s.openedAgoH).getTime() + 72 * HOUR),
      sentA: a === opener ? s.sentOpener : s.sentOther,
      sentB: b === opener ? s.sentOpener : s.sentOther,
      aDecision: (before.a_decision as ChatDecision | null) ?? null,
      bDecision: (before.b_decision as ChatDecision | null) ?? null,
      closedReason: null,
      closedBy: null,
    };
    const person = { opener, other, stranger }[
      e.type === "tick" ? "opener" : e.who
    ];
    const event: ConvEvent =
      e.type === "message"
        ? { type: "message", from: person }
        : e.type === "decide"
          ? { type: "decide", by: person, decision: e.decision, note: "NOTE" }
          : { type: "tick" };
    const expected = nextState(conv, event, NOW, { unavailable: s.blocked });

    let sqlCode: string;
    if (e.type === "message") {
      sqlCode = await codeOf(() => send(person, chatId, "hi there"));
    } else if (e.type === "decide") {
      sqlCode = await codeOf(() => decide(person, chatId, e.decision));
    } else {
      sqlCode = await codeOf(() => expire());
    }

    const after = await row(chatId);
    if (!expected.ok) {
      // Same refusal, and nothing was changed.
      expect(sqlCode).toBe(expected.error);
      expect(after).toEqual(before);
      return;
    }
    expect(sqlCode).toBe("ok");
    expect(after.status).toBe(expected.conv.status);
    expect(after.a_decision).toBe(expected.conv.aDecision);
    expect(after.b_decision).toBe(expected.conv.bDecision);
    expect(after.closed_by).toBe(expected.conv.closedBy);
    expect(after.closed_reason).toBe(expected.conv.closedReason);
    expect(await sentCount(chatId, a)).toBe(expected.conv.sentA);
    expect(await sentCount(chatId, b)).toBe(expected.conv.sentB);
  });
});

// ---------------------------------------------------------------------------
// Message rules
// ---------------------------------------------------------------------------
describe("send_message rules", () => {
  it("lets the opener write first and stores the message", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    const r = await send(opener, chat, "Hi!");
    expect(r.first_from_sender).toBe(true);
    expect(r.first_reply).toBe(false);
    expect(await sentCount(chat, opener)).toBe(1);
  });

  it("does not let the other person write before the opener", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    expect(await codeOf(() => send(other, chat, "Hello?"))).toBe(
      "wait_for_opener",
    );
  });

  it("marks the other person's first message as the first reply", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    await send(opener, chat, "Hi!");
    const r = await send(other, chat, "Hello!");
    expect(r.first_reply).toBe(true);
    const second = await send(other, chat, "How are you?");
    expect(second.first_from_sender).toBe(false);
  });

  it("stops the opener after the allowed messages until there is a reply", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    for (let i = 0; i < CONVERSATION_CONFIG.maxMessagesBeforeReply; i++) {
      await send(opener, chat, `message ${i}`, {
        now: new Date(NOW.getTime() + i * 1000),
      });
    }
    expect(await codeOf(() => send(opener, chat, "again"))).toBe(
      "wait_for_reply",
    );
    await send(other, chat, "Sorry, I am here");
    expect(await codeOf(() => send(opener, chat, "great"))).toBe("ok");
  });

  it("refuses a stranger", async () => {
    const { opener, other } = await pair();
    const stranger = await createUser("stranger");
    const chat = await addChat({ a: opener, b: other, opener });
    expect(await codeOf(() => send(stranger, chat, "let me in"))).toBe(
      "not_participant",
    );
    expect(await codeOf(() => send(opener, randomUUID(), "x"))).toBe(
      "not_participant",
    );
  });

  it("refuses after the window has ended, but not just before", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({
      a: opener,
      b: other,
      opener,
      openedAgoH: 71.99,
    });
    expect(await codeOf(() => send(opener, chat, "just in time"))).toBe("ok");
    const late = await addChat({
      a: opener,
      b: await createUser("late"),
      opener,
      openedAgoH: 72,
    });
    expect(await codeOf(() => send(opener, late, "too late"))).toBe(
      "window_ended",
    );
  });

  it("allows kept chats to go on past the window, and refuses closed ones", async () => {
    const { opener, other } = await pair();
    const kept = await addChat({
      a: opener,
      b: other,
      opener,
      status: "kept",
      openedAgoH: 500,
    });
    expect(await codeOf(() => send(opener, kept, "still here"))).toBe("ok");
    const x = await createUser("x");
    for (const status of ["closed", "expired"]) {
      const chat = await addChat({ a: opener, b: x, opener, status });
      expect(await codeOf(() => send(opener, chat, "hi"))).toBe("not_open");
    }
  });

  it("refuses when either person blocked the other", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    await db.query(
      `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
      [other, opener],
    );
    expect(await codeOf(() => send(opener, chat, "hi"))).toBe("unavailable");
    expect(await codeOf(() => send(other, chat, "hi"))).toBe("unavailable");
  });

  it("refuses when the other account is suspended or deleted", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    await db.query(
      `update public.profiles set suspended_at = now() where id = $1`,
      [other],
    );
    expect(await codeOf(() => send(opener, chat, "hi"))).toBe("unavailable");
  });

  it("refuses blank, too long and control-character messages", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    expect(await codeOf(() => send(opener, chat, "   \n\t "))).toBe("empty");
    expect(await codeOf(() => send(opener, chat, ""))).toBe("empty");
    expect(
      await codeOf(() =>
        send(
          opener,
          chat,
          "x".repeat(CONVERSATION_CONFIG.messageMaxLength + 1),
        ),
      ),
    ).toBe("too_long");
    expect(
      await codeOf(() =>
        send(opener, chat, "x".repeat(CONVERSATION_CONFIG.messageMaxLength)),
      ),
    ).toBe("ok");
    expect(await codeOf(() => send(opener, chat, "bell\u0007here"))).toBe(
      "empty",
    );
    // Newlines and tabs are allowed.
    expect(await codeOf(() => send(opener, chat, "line one\nline\ttwo"))).toBe(
      "ok",
    );
  });

  it("records the contact-info flag, which users cannot read", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    await send(opener, chat, "call me 98765 43210", { flagged: true });
    await send(opener, chat, "normal message", {
      now: new Date(NOW.getTime() + 1000),
    });
    const flagged = await db.query<{ n: string }>(
      `select count(*) as n from public.messages where conversation_id = $1 and flagged`,
      [chat],
    );
    expect(Number(flagged.rows[0].n)).toBe(1);
    await expect(
      actAs(other, () =>
        db.query(
          `select flagged from public.messages where conversation_id = $1`,
          [chat],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot be called by a signed-in user or a visitor", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener });
    for (const who of [opener, "anon"] as const) {
      await expect(
        actAs(who, () =>
          db.query(`select public.send_message($1, $2, 'hi')`, [opener, chat]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
    for (const who of [opener, "anon"] as const) {
      await expect(
        actAs(who, () => db.query(`select public.expire_conversations()`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        actAs(who, () =>
          db.query(`select public.record_decision($1, $2, 'keep')`, [
            opener,
            chat,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------
describe("message rate limit", () => {
  async function talkingPair() {
    const { opener, other } = await pair();
    const chat = await addChat({
      a: opener,
      b: other,
      opener,
      openedAgoH: 5,
    });
    await addMessages(chat, opener, 1);
    await addMessages(chat, other, 1);
    return { opener, other, chat };
  }
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

  it("allows N messages a minute and refuses the next, then lets go", async () => {
    const { opener, chat } = await talkingPair();
    const perMinute = CONVERSATION_CONFIG.rateLimitPerMinute;
    for (let i = 0; i < perMinute; i++) {
      expect(
        await codeOf(() => send(opener, chat, `m${i}`, { now: at(i) })),
      ).toBe("ok");
    }
    expect(
      await codeOf(() => send(opener, chat, "one too many", { now: at(10) })),
    ).toBe("rate_limited");
    // A minute after the first message, there is room again.
    expect(
      await codeOf(() => send(opener, chat, "later", { now: at(61) })),
    ).toBe("ok");
  });

  it("counts a person's messages across all their chats", async () => {
    const { opener, chat } = await talkingPair();
    const second = await talkingPair();
    // Use the second pair's opener as a participant in a second chat with the
    // first opener, so one person has two chats.
    const chat2 = await addChat({
      a: opener,
      b: second.other,
      opener: second.other,
      openedAgoH: 5,
    });
    await addMessages(chat2, second.other, 1);
    for (let i = 0; i < 4; i++) {
      await send(opener, chat, `a${i}`, { now: at(i) });
      await send(opener, chat2, `b${i}`, { now: at(i) });
    }
    expect(
      await codeOf(() => send(opener, chat, "nine", { now: at(20) })),
    ).toBe("rate_limited");
    expect(
      await codeOf(() => send(opener, chat2, "nine", { now: at(20) })),
    ).toBe("rate_limited");
  });

  it("does not slow down somebody else", async () => {
    const { opener, other, chat } = await talkingPair();
    for (let i = 0; i < CONVERSATION_CONFIG.rateLimitPerMinute; i++) {
      await send(opener, chat, `m${i}`, { now: at(i) });
    }
    expect(
      await codeOf(() =>
        send(other, chat, "I can still write", { now: at(5) }),
      ),
    ).toBe("ok");
  });

  it("also has an hourly limit", async () => {
    const { opener, chat } = await talkingPair();
    const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);
    const opts = (m: number) => ({
      now: minutes(m),
      perMinute: 100,
      perHour: 3,
    });
    for (const m of [0, 10, 20]) {
      expect(await codeOf(() => send(opener, chat, `m${m}`, opts(m)))).toBe(
        "ok",
      );
    }
    expect(await codeOf(() => send(opener, chat, "fourth", opts(30)))).toBe(
      "rate_limited",
    );
    // 70 minutes in, only the 10, 20 minute messages are still inside the hour.
    expect(await codeOf(() => send(opener, chat, "later", opts(70)))).toBe(
      "ok",
    );
  });
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
describe("keep and close", () => {
  async function dayThree(openedAgoH = 49) {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener, openedAgoH });
    await addMessages(chat, opener, 1);
    await addMessages(chat, other, 1);
    return { opener, other, chat };
  }

  it("keep + keep makes a kept chat", async () => {
    const { opener, other, chat } = await dayThree();
    expect((await decide(opener, chat, "keep")).status).toBe("waiting");
    expect((await row(chat)).status).toBe("open");
    expect((await decide(other, chat, "keep")).status).toBe("kept");
    const r = await row(chat);
    expect(r.status).toBe("kept");
    expect(r.closed_at).toBeNull();
  });

  it("keep + close closes with the kind note, whoever goes first", async () => {
    const first = await dayThree();
    await decide(first.opener, first.chat, "keep");
    expect(
      (
        await decide(first.other, first.chat, "close", {
          note: "Thanks, take care.",
        })
      ).status,
    ).toBe("closed");
    let r = await row(first.chat);
    expect(r.status).toBe("closed");
    expect(r.closed_by).toBe(first.other);
    expect(r.closed_reason).toBe("Thanks, take care.");
    expect(r.closed_at).not.toBeNull();

    const second = await dayThree();
    await decide(second.other, second.chat, "close");
    r = await row(second.chat);
    expect(r.status).toBe("closed");
    expect(r.closed_by).toBe(second.other);
  });

  it("close + close: the second person finds it already closed", async () => {
    const { opener, other, chat } = await dayThree();
    await decide(opener, chat, "close");
    expect(await codeOf(() => decide(other, chat, "close"))).toBe("not_open");
  });

  it("only one person decides: nothing changes until expiry, then it expires", async () => {
    const { opener, chat } = await dayThree();
    await decide(opener, chat, "keep");
    expect((await row(chat)).status).toBe("open");
    await expire(NOW); // window not over yet
    expect((await row(chat)).status).toBe("open");
    await expire(new Date(NOW.getTime() + 30 * HOUR));
    const r = await row(chat);
    expect(r.status).toBe("expired");
    expect(r.closed_reason).toBe("No decision within the window.");
  });

  it("keep can change to close, close cannot change back", async () => {
    const { opener, other, chat } = await dayThree();
    await decide(opener, chat, "keep");
    await decide(opener, chat, "close");
    expect((await row(chat)).status).toBe("closed");
    expect(await codeOf(() => decide(opener, chat, "keep"))).toBe("not_open");
    expect(other).toBeTruthy();
  });

  it("a repeated keep changes nothing", async () => {
    const { opener, chat } = await dayThree();
    expect((await decide(opener, chat, "keep")).changed).toBe(true);
    expect((await decide(opener, chat, "keep")).changed).toBe(false);
  });

  it("is not open before day 3, even when both have written", async () => {
    const { opener, chat } = await dayThree(47.9);
    expect(await codeOf(() => decide(opener, chat, "keep"))).toBe(
      "decision_not_open",
    );
    const early = await dayThree(48);
    expect(await codeOf(() => decide(early.opener, early.chat, "keep"))).toBe(
      "ok",
    );
  });

  it("is not open when only one person has written", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener, openedAgoH: 60 });
    await addMessages(chat, opener, 1);
    expect(await codeOf(() => decide(opener, chat, "close"))).toBe(
      "decision_not_open",
    );
  });

  it("refuses a bad note", async () => {
    const { opener, chat } = await dayThree();
    const long = "x".repeat(201);
    const result = await codeOf(() =>
      decide(opener, chat, "close", { note: long }),
    );
    expect(result).toBe("bad_note");
  });
});

// ---------------------------------------------------------------------------
// Reply rate
// ---------------------------------------------------------------------------
describe("reply rate", () => {
  type Ending = "kept" | "closed" | "expired";

  async function ended(sentOpener: number, sentOther: number, how: Ending) {
    const { opener, other } = await pair();
    const chat = await addChat({ a: other, b: opener, opener, openedAgoH: 49 });
    await addMessages(chat, opener, sentOpener);
    await addMessages(chat, other, sentOther);
    if (how === "kept") {
      await decide(opener, chat, "keep");
      await decide(other, chat, "keep");
    } else if (how === "closed") {
      await decide(other, chat, "close");
    } else {
      await expire(new Date(NOW.getTime() + 40 * HOUR));
    }
    return { opener, other, chat };
  }

  const table: [string, number, number, Ending][] = [
    ["both wrote, kept", 1, 1, "kept"],
    ["both wrote, closed", 2, 1, "closed"],
    ["both wrote, expired without a decision", 1, 2, "expired"],
    ["only the opener wrote, expired", 1, 0, "expired"],
    ["nobody wrote, expired", 0, 0, "expired"],
  ];

  it.each(table)("%s", async (_name, sentOpener, sentOther, how) => {
    const { opener, other } = await ended(sentOpener, sentOther, how);
    // Expected by the TypeScript rule.
    const deltas = replyRateDeltas({
      status: "expired",
      userA: opener,
      userB: other,
      openerId: opener,
      openedAt: NOW,
      windowEndsAt: NOW,
      sentA: sentOpener,
      sentB: sentOther,
      aDecision: null,
      bDecision: null,
      closedReason: null,
      closedBy: null,
    });
    const want = (id: string) =>
      deltas.find((d) => d.userId === id) ?? { num: 0, den: 0 };
    expect(await rate(opener)).toEqual({
      num: want(opener).num,
      den: want(opener).den,
    });
    expect(await rate(other)).toEqual({
      num: want(other).num,
      den: want(other).den,
    });
  });

  it("spells out the cases in numbers", async () => {
    // Nobody wrote: the opener owes a message and did not send one; the other
    // person was never written to, so nothing counts against them.
    const none = await ended(0, 0, "expired");
    expect(await rate(none.opener)).toEqual({ num: 0, den: 1 });
    expect(await rate(none.other)).toEqual({ num: 0, den: 0 });
    // The opener wrote and the other never replied.
    const quiet = await ended(1, 0, "expired");
    expect(await rate(quiet.opener)).toEqual({ num: 1, den: 1 });
    expect(await rate(quiet.other)).toEqual({ num: 0, den: 1 });
  });

  it("counts a chat only once, however it ends and however often the job runs", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener, openedAgoH: 80 });
    await addMessages(chat, opener, 1);
    await expire();
    await expire();
    await expire(new Date(NOW.getTime() + 5 * HOUR));
    expect(await rate(opener)).toEqual({ num: 1, den: 1 });
    expect(await rate(other)).toEqual({ num: 0, den: 1 });
    // A late decision on the ended chat is refused and counts nothing.
    expect(await codeOf(() => decide(opener, chat, "keep"))).toBe("not_open");
    expect(await rate(opener)).toEqual({ num: 1, den: 1 });
  });

  it("adds up over several chats", async () => {
    const { opener, other } = await pair();
    for (const [sentOpener, sentOther] of [
      [1, 1],
      [1, 0],
      [0, 0],
    ]) {
      const third = await createUser("third");
      const chat = await addChat({
        a: opener,
        b: third,
        opener,
        openedAgoH: 80,
      });
      await addMessages(chat, opener, sentOpener);
      await addMessages(chat, third, sentOther);
    }
    await expire();
    // opener owed 3 first messages and sent 2.
    expect(await rate(opener)).toEqual({ num: 2, den: 3 });
    expect(other).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Expiry job
// ---------------------------------------------------------------------------
describe("expire_conversations", () => {
  it("ends only the open chats whose time is up, and reports counts and people", async () => {
    await expire(new Date(NOW.getTime() + 1000 * HOUR)); // flush leftovers
    const a = await pair();
    const b = await pair();
    const c = await pair();
    const stale = await addChat({
      a: a.opener,
      b: a.other,
      opener: a.opener,
      openedAgoH: 80,
    });
    const stale2 = await addChat({
      a: b.opener,
      b: b.other,
      opener: b.opener,
      openedAgoH: 90,
    });
    await addMessages(stale2, b.opener, 1);
    const fresh = await addChat({
      a: c.opener,
      b: c.other,
      opener: c.opener,
      openedAgoH: 10,
    });
    const kept = await addChat({
      a: a.opener,
      b: c.other,
      opener: a.opener,
      status: "kept",
      openedAgoH: 400,
    });

    const result = await expire();
    expect(result.expired).toBe(2);
    expect(result.no_first_message).toBe(1);
    expect(result.no_reply).toBe(1);
    expect(result.no_decision).toBe(0);
    expect((result.user_ids as string[]).sort()).toEqual(
      [a.opener, a.other, b.opener, b.other].sort(),
    );
    expect((await row(stale)).status).toBe("expired");
    expect((await row(stale2)).status).toBe("expired");
    expect((await row(fresh)).status).toBe("open");
    expect((await row(kept)).status).toBe("kept");

    // Idempotent: nothing left to do.
    expect((await expire()).expired).toBe(0);
  });

  it("frees the slot so a waiting match can open (cap effect)", async () => {
    // Y has 3 open chats. X said Interested to Y, and Y to X, in one drop.
    await expire(new Date(NOW.getTime() + 1000 * HOUR));
    const x = await createUser("x");
    const y = await createUser("y");
    await db.query(`update public.profiles set gender = 'man' where id = $1`, [
      x,
    ]);
    await db.query(
      `update public.profiles set gender = 'woman' where id = $1`,
      [y],
    );
    const stale: string[] = [];
    for (let i = 0; i < SHORTLIST_CONFIG.chatCapFree; i++) {
      const filler = await createUser("filler");
      stale.push(
        await addChat({ a: y, b: filler, opener: y, openedAgoH: 80 + i }),
      );
    }
    const drop = await db.query<{ id: string }>(
      `insert into public.drops (week_start) values ('2026-11-16') returning id`,
    );
    const mk = async (viewer: string, candidate: string) =>
      (
        await db.query<{ id: string }>(
          `insert into public.intros (drop_id, viewer_id, candidate_id, status, decided_at)
           values ($1, $2, $3, 'interested', '2026-11-17T10:00:00Z') returning id`,
          [drop.rows[0].id, viewer, candidate],
        )
      ).rows[0].id;
    const xIntro = await mk(x, y);
    await mk(y, x);

    const tryOpen = async () =>
      (
        await actAs("service", () =>
          db.query<{ r: Json }>(
            `select public.decide_intro($1, $2, 'interested', null, $3::timestamptz,
                    3, 5, 72, 9510, true) as r`,
            [x, xIntro, iso(NOW)],
          ),
        )
      ).rows[0].r;

    // Y is at the cap, so the match waits (and says nothing more).
    expect((await tryOpen()).reason).toBe("other_at_cap");

    // The three chats run out of time...
    await expire();
    for (const id of stale) expect((await row(id)).status).toBe("expired");

    // ...and the repeated "Interested" now opens the chat.
    const again = await tryOpen();
    expect(again.status).toBe("opened");
  });

  it("a kept chat keeps its slot", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({ a: opener, b: other, opener, openedAgoH: 49 });
    await addMessages(chat, opener, 1);
    await addMessages(chat, other, 1);
    await decide(opener, chat, "keep");
    await decide(other, chat, "keep");
    await expire(new Date(NOW.getTime() + 1000 * HOUR));
    const live = await db.query<{ n: string }>(
      `select count(*) as n from public.conversations
        where status in ('open','kept') and $1 in (user_a, user_b)`,
      [opener],
    );
    expect(Number(live.rows[0].n)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Who can read what
// ---------------------------------------------------------------------------
describe("privacy and row level security", () => {
  async function talking() {
    const { opener, other } = await pair();
    const stranger = await createUser("stranger");
    const chat = await addChat({ a: opener, b: other, opener, openedAgoH: 5 });
    await send(opener, chat, "secret hello", { now: ago(4) });
    await send(other, chat, "secret reply", { now: ago(3) });
    return { opener, other, stranger, chat };
  }

  it("lets both people read the messages, and nobody else", async () => {
    const { opener, other, stranger, chat } = await talking();
    const read = (who: string) =>
      actAs(
        who,
        async () =>
          (
            await db.query(
              `select id, body from public.messages where conversation_id = $1`,
              [chat],
            )
          ).rows,
      );
    expect(await read(opener)).toHaveLength(2);
    expect(await read(other)).toHaveLength(2);
    expect(await read(stranger)).toHaveLength(0);
  });

  it("refuses direct inserts, even by a participant", async () => {
    const { opener, stranger, chat } = await talking();
    for (const who of [opener, stranger]) {
      await expect(
        actAs(who, () =>
          db.query(
            `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'x')`,
            [chat, who],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("hides the chat from a stranger: no row, no state, no way to mark it read", async () => {
    const { stranger, chat } = await talking();
    const seen = await actAs(
      stranger,
      async () =>
        (
          await db.query(`select id from public.conversations where id = $1`, [
            chat,
          ])
        ).rows,
    );
    expect(seen).toHaveLength(0);
    const state = await actAs(stranger, () =>
      db.query<{ r: Json | null }>(`select public.get_conversation($1) as r`, [
        chat,
      ]),
    );
    expect(state.rows[0].r).toBeNull();
    await expect(
      actAs(stranger, () =>
        db.query(`select public.mark_conversation_read($1)`, [chat]),
      ),
    ).rejects.toThrow(/conversation_not_found/);
  });

  it("does not let anyone read the other person's Keep or Close", async () => {
    const { opener, other, chat } = await talking();
    await db.query(
      `update public.conversations set opened_at = $2, window_ends_at = $3 where id = $1`,
      [chat, iso(ago(49)), iso(new Date(ago(49).getTime() + 72 * HOUR))],
    );
    await decide(opener, chat, "keep");
    for (const who of [opener, other]) {
      await expect(
        actAs(who, () =>
          db.query(
            `select a_decision from public.conversations where id = $1`,
            [chat],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
    const mine = await actAs(opener, () =>
      db.query<{ r: { my_decision: string | null } }>(
        `select public.get_conversation($1) as r`,
        [chat],
      ),
    );
    const theirs = await actAs(other, () =>
      db.query<{ r: { my_decision: string | null } }>(
        `select public.get_conversation($1) as r`,
        [chat],
      ),
    );
    expect(mine.rows[0].r.my_decision).toBe("keep");
    expect(theirs.rows[0].r.my_decision).toBeNull();
  });

  it("keeps last_read_at private and updates only your own marker", async () => {
    const { opener, other, stranger, chat } = await talking();
    await actAs(opener, () =>
      db.query(`select public.mark_conversation_read($1)`, [chat]),
    );
    const own = await actAs(
      opener,
      async () =>
        (
          await db.query(
            `select user_id, last_read_at from public.conversation_reads`,
          )
        ).rows,
    );
    expect(own).toHaveLength(1);
    // The other participant and a stranger see no rows at all.
    for (const who of [other, stranger]) {
      const seen = await actAs(
        who,
        async () =>
          (await db.query(`select * from public.conversation_reads`)).rows,
      );
      expect(seen).toHaveLength(0);
    }
    // Nobody can write the table directly.
    for (const stmt of [
      `insert into public.conversation_reads (conversation_id, user_id) values ('${chat}', '${other}')`,
      `update public.conversation_reads set last_read_at = now()`,
      `delete from public.conversation_reads`,
    ]) {
      await expect(actAs(opener, () => db.query(stmt))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("shows unread counts only to the person who has not read", async () => {
    // Uses the database's own clock, because mark_conversation_read() stamps
    // "now" itself.
    const { opener, other } = await pair();
    const chat = (
      await db.query<{ id: string }>(
        `insert into public.conversations (user_a, user_b, opener_id, status, opened_at, window_ends_at)
         values ($1, $2, $1, 'open', now() - interval '3 hours', now() + interval '69 hours')
         returning id`,
        [opener, other],
      )
    ).rows[0].id;
    await db.query(
      `insert into public.messages (conversation_id, sender_id, body, created_at)
       values ($1, $2, 'secret hello', now() - interval '2 hours'),
              ($1, $3, 'secret reply', now() - interval '1 hour')`,
      [chat, opener, other],
    );
    const summary = (who: string) =>
      actAs(who, async () =>
        (
          await db.query<{
            conversation_id: string;
            last_body: string;
            unread: number;
            i_sent: number;
            they_sent: number;
          }>(`select * from public.my_conversation_summaries()`)
        ).rows.find((r) => r.conversation_id === chat),
      );

    expect((await summary(opener))?.unread).toBe(1); // the reply
    expect((await summary(other))?.unread).toBe(1); // the hello
    expect((await summary(opener))?.last_body).toBe("secret reply");
    expect((await summary(opener))?.i_sent).toBe(1);
    expect((await summary(opener))?.they_sent).toBe(1);

    await actAs(other, () =>
      db.query(`select public.mark_conversation_read($1)`, [chat]),
    );
    expect((await summary(other))?.unread).toBe(0);
    // The opener's unread count did not change because the other person read.
    expect((await summary(opener))?.unread).toBe(1);

    // A newer message from the opener is unread for the other person only.
    await db.query(
      `insert into public.messages (conversation_id, sender_id, body, created_at)
       values ($1, $2, 'one more', clock_timestamp() + interval '1 minute')`,
      [chat, opener],
    );
    expect((await summary(other))?.unread).toBe(1);
    expect((await summary(opener))?.unread).toBe(1);
  });

  it("returns no preview for an ended chat (its messages are not readable)", async () => {
    const { opener, other } = await pair();
    const chat = await addChat({
      a: opener,
      b: other,
      opener,
      status: "closed",
    });
    await addMessages(chat, opener, 1);
    const rows = await actAs(opener, async () =>
      (
        await db.query<{ conversation_id: string; last_body: string | null }>(
          `select conversation_id, last_body from public.my_conversation_summaries()`,
        )
      ).rows.filter((r) => r.conversation_id === chat),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].last_body).toBeNull();
  });

  it("describes the chat to a participant without revealing why it is unavailable", async () => {
    const { opener, other, chat } = await talking();
    await db.query(
      `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
      [other, opener],
    );
    const asOpener = await actAs(opener, () =>
      db.query<{ r: Json }>(`select public.get_conversation($1) as r`, [chat]),
    );
    expect(asOpener.rows[0].r.unavailable).toBe(true);
    expect(JSON.stringify(asOpener.rows[0].r)).not.toContain("block");
  });
});

// ---------------------------------------------------------------------------
// Realtime publication
// ---------------------------------------------------------------------------
describe("realtime publication", () => {
  it("adds messages to supabase_realtime when that publication exists, and works without it", async () => {
    // The main database has no such publication (plain Postgres): the
    // migration must have been a no-op, not an error. That is already proven
    // by the migrations running above. Here we try the other branch.
    const other = new PGlite();
    try {
      await other.exec(
        readFileSync(join(root, "tests/rls/bootstrap.sql"), "utf8"),
      );
      let supported = true;
      try {
        await other.exec("create publication supabase_realtime");
      } catch {
        supported = false; // this engine build cannot make publications
      }
      const dir = join(root, "supabase/migrations");
      for (const file of readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        await other.exec(readFileSync(join(dir, file), "utf8"));
      }
      if (supported) {
        const r = await other.query<{ n: string }>(
          `select count(*) as n from pg_publication_tables
            where pubname = 'supabase_realtime' and tablename = 'messages'`,
        );
        expect(Number(r.rows[0].n)).toBe(1);
      }
    } finally {
      await other.close();
    }
  }, 60_000);
});
