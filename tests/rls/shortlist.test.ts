import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import { decideIntro, type DecideOutcome } from "@/lib/shortlist/decide";
import { outcomeFromError, outcomeFromResult } from "@/lib/shortlist/service";
import { input, type Overrides } from "../unit/shortlist-fixtures";

// decide_intro(), my_shortlist() and conversation_intro_notes() against a real
// Postgres (PGlite). PGlite runs one connection, so "concurrent" calls are
// queued rather than truly parallel: they prove the answer is correct for any
// order of the calls, not that the advisory locks work under real parallelism.

const root = process.cwd();
let db: PGlite;

const WEEK = "2026-11-16";
const NOW = new Date("2026-11-18T10:00:00Z");
const AFTER_EXPIRY = new Date("2026-11-22T14:30:00Z");

let dropId: string;

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
  return id;
}

async function member(
  gender: string | null,
  opts: { plus?: boolean; paused?: boolean } = {},
) {
  const id = await createUser(gender ?? "member");
  await db.query(
    `update public.profiles
        set gender = $2::public.gender, onboarding_completed_at = now(),
            paused = $3, plus_until = $4
      where id = $1`,
    [
      id,
      gender,
      opts.paused ?? false,
      opts.plus ? "2027-01-01T00:00:00Z" : null,
    ],
  );
  return id;
}

async function addIntro(
  viewer: string,
  candidate: string,
  status: string,
  opts: { note?: string; decidedAt?: string } = {},
) {
  const r = await db.query<{ id: string }>(
    `insert into public.intros (drop_id, viewer_id, candidate_id, status, note, decided_at)
     values ($1, $2, $3, $4::public.intro_status, $5, $6) returning id`,
    [
      dropId,
      viewer,
      candidate,
      status,
      opts.note ?? null,
      status === "new"
        ? null
        : (opts.decidedAt ??
          (viewer < candidate
            ? "2026-11-17T10:00:00Z"
            : "2026-11-17T11:00:00Z")),
    ],
  );
  return r.rows[0].id;
}

async function addChat(a: string, b: string, status = "open") {
  const r = await db.query<{ id: string }>(
    `insert into public.conversations (user_a, user_b, opener_id, status, window_ends_at)
     values ($1, $2, $1, $3::public.conversation_status, now() + interval '72 hours')
     returning id`,
    [a, b, status],
  );
  return r.rows[0].id;
}

// Gives a person n open chats with throwaway people.
async function fillChats(person: string, n: number) {
  for (let i = 0; i < n; i++) await addChat(person, await member(null));
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

type Raw = {
  status?: string;
  reason?: string;
  conversation_id?: string | null;
  opener_id?: string | null;
};

async function decide(
  viewer: string,
  intro: string,
  decision: "interested" | "passed",
  opts: { note?: string | null; now?: Date; womanOpens?: boolean } = {},
): Promise<Raw> {
  const r = await actAs("service", () =>
    db.query<{ r: Raw }>(
      `select public.decide_intro($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10) as r`,
      [
        viewer,
        intro,
        decision,
        opts.note ?? null,
        (opts.now ?? NOW).toISOString(),
        SHORTLIST_CONFIG.chatCapFree,
        SHORTLIST_CONFIG.chatCapPlus,
        SHORTLIST_CONFIG.windowHours,
        SHORTLIST_CONFIG.introExpiryMinutesAfterWeekStart,
        opts.womanOpens ?? SHORTLIST_CONFIG.womanOpens,
      ],
    ),
  );
  return r.rows[0].r;
}

async function decideError(
  ...args: Parameters<typeof decide>
): Promise<string> {
  try {
    await decide(...args);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "no error";
}

const chatsBetween = async (a: string, b: string) =>
  Number(
    (
      await db.query<{ n: string }>(
        `select count(*) as n from public.conversations
          where least(user_a, user_b) = least($1::uuid, $2::uuid)
            and greatest(user_a, user_b) = greatest($1::uuid, $2::uuid)`,
        [a, b],
      )
    ).rows[0].n,
  );

const introRow = async (id: string) =>
  (
    await db.query<{
      status: string;
      note: string | null;
      decided_at: string | null;
    }>(`select status, note, decided_at from public.intros where id = $1`, [id])
  ).rows[0];

// A viewer and another person with intros about each other, in the state given.
async function pair(o: { viewer?: string | null; other?: string | null } = {}) {
  const viewer = await member(o.viewer === undefined ? "man" : o.viewer);
  const other = await member(o.other === undefined ? "woman" : o.other);
  return { viewer, other };
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
  const d = await db.query<{ id: string }>(
    `insert into public.drops (week_start) values ($1) returning id`,
    [WEEK],
  );
  dropId = d.rows[0].id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// The same cases as the pure rulebook, run through the database function.
// ---------------------------------------------------------------------------
describe("decide_intro matches the TypeScript rulebook", () => {
  const cases: [string, Overrides][] = [
    ["man first, she has not answered", { otherIntro: "new" }],
    ["man first, she passed", { otherIntro: "passed" }],
    ["man after woman", { otherIntro: "interested" }],
    [
      "woman after man",
      { viewerGender: "woman", otherGender: "man", otherIntro: "interested" },
    ],
    [
      "woman first, man has not answered",
      { viewerGender: "woman", otherGender: "man", otherIntro: "new" },
    ],
    [
      "woman-woman mutual",
      { viewerGender: "woman", otherGender: "woman", otherIntro: "interested" },
    ],
    [
      "woman-woman waiting",
      { viewerGender: "woman", otherGender: "woman", otherIntro: "new" },
    ],
    [
      "man-man mutual",
      { viewerGender: "man", otherGender: "man", otherIntro: "interested" },
    ],
    [
      "non-binary with woman",
      {
        viewerGender: "non_binary",
        otherGender: "woman",
        otherIntro: "interested",
      },
    ],
    [
      "woman with non-binary",
      {
        viewerGender: "woman",
        otherGender: "non_binary",
        otherIntro: "interested",
      },
    ],
    [
      "non-binary with man waiting",
      { viewerGender: "non_binary", otherGender: "man", otherIntro: "new" },
    ],
    [
      "missing gender",
      { viewerGender: null, otherGender: "woman", otherIntro: "interested" },
    ],
    ["other has no intro about me", { otherIntro: null }],
    ["pass", { decision: "passed" }],
    [
      "pass when she is interested",
      { decision: "passed", otherIntro: "interested" },
    ],
    ["pass repeated", { decision: "passed", status: "passed" }],
    ["pass after interested", { decision: "passed", status: "interested" }],
    ["interested after pass", { status: "passed" }],
    [
      "interested repeated, waiting",
      { status: "interested", otherIntro: "new" },
    ],
    [
      "interested repeated, now mutual (retry)",
      { status: "interested", otherIntro: "interested" },
    ],
    [
      "interested repeated, chat already open",
      {
        status: "interested",
        otherIntro: "interested",
        liveChat: true,
        viewerChats: 1,
        otherChats: 1,
      },
    ],
    [
      "viewer at free cap, she interested",
      { viewerChats: 3, otherIntro: "interested" },
    ],
    ["viewer at free cap, she not", { viewerChats: 3, otherIntro: "new" }],
    ["viewer at 2 of 3", { viewerChats: 2, otherIntro: "interested" }],
    [
      "viewer Plus at 4 of 5",
      { viewerChats: 4, viewerCap: 5, otherIntro: "interested" },
    ],
    [
      "viewer Plus at 5 of 5",
      { viewerChats: 5, viewerCap: 5, otherIntro: "interested" },
    ],
    ["other at cap", { otherChats: 3, otherIntro: "interested" }],
    ["other at cap but not interested", { otherChats: 3, otherIntro: "new" }],
    [
      "other Plus at 3 of 5",
      { otherChats: 3, otherCap: 5, otherIntro: "interested" },
    ],
    [
      "retry but viewer filled up",
      { status: "interested", viewerChats: 3, otherIntro: "interested" },
    ],
    ["pass at cap", { decision: "passed", viewerChats: 3 }],
    ["blocked", { blocked: true, otherIntro: "interested" }],
    ["other paused", { otherAvailable: false, otherIntro: "interested" }],
    ["viewer paused", { viewerAvailable: false }],
    ["expired by time", { expired: true }],
    ["expired by time, repeat", { expired: true, status: "interested" }],
  ];

  it.each(cases)("%s", async (_name, o) => {
    const viewer = await member(
      o.viewerGender === undefined ? "man" : o.viewerGender,
      {
        plus: o.viewerCap === 5,
        paused: o.viewerAvailable === false,
      },
    );
    const other = await member(
      o.otherGender === undefined ? "woman" : o.otherGender,
      {
        plus: o.otherCap === 5,
        paused: o.otherAvailable === false,
      },
    );
    const status = o.status ?? "new";
    const mine = await addIntro(viewer, other, status, {
      decidedAt: "2026-11-18T09:30:00Z",
    });
    if (o.otherIntro !== null) {
      await addIntro(other, viewer, o.otherIntro ?? "new", {
        decidedAt: "2026-11-18T09:00:00Z",
      });
    }
    if (o.liveChat) await addChat(viewer, other);
    await fillChats(viewer, (o.viewerChats ?? 0) - (o.liveChat ? 1 : 0));
    await fillChats(other, (o.otherChats ?? 0) - (o.liveChat ? 1 : 0));
    if (o.blocked) {
      await db.query(
        `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
        [other, viewer],
      );
    }

    let actual: DecideOutcome | null;
    try {
      const raw = await decide(viewer, mine, o.decision ?? "interested", {
        now: o.expired ? AFTER_EXPIRY : NOW,
      });
      actual = outcomeFromResult(raw, viewer);
    } catch (e) {
      actual = outcomeFromError(e instanceof Error ? e.message : String(e));
    }

    const expected = decideIntro(input(o), {
      womanOpens: SHORTLIST_CONFIG.womanOpens,
    });
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
describe("opening exactly one conversation", () => {
  it("opens with the right opener, window, origin intros and status", async () => {
    const { viewer, other } = await pair(); // man, woman
    const mine = await addIntro(viewer, other, "new");
    const hers = await addIntro(other, viewer, "interested");

    const out = await decide(viewer, mine, "interested");
    expect(out.status).toBe("opened");
    expect(out.opener_id).toBe(other); // the woman opens

    const c = (
      await db.query<{
        user_a: string;
        user_b: string;
        opener_id: string;
        status: string;
        opened_at: string;
        window_ends_at: string;
        origin_intro_a: string;
        origin_intro_b: string;
      }>(`select * from public.conversations where id = $1`, [
        out.conversation_id,
      ])
    ).rows[0];
    expect(c.status).toBe("open");
    expect(c.opener_id).toBe(other);
    expect(new Date(c.opened_at).toISOString()).toBe(NOW.toISOString());
    expect(new Date(c.window_ends_at).getTime() - NOW.getTime()).toBe(
      SHORTLIST_CONFIG.windowHours * 3600 * 1000,
    );
    expect(new Set([c.origin_intro_a, c.origin_intro_b])).toEqual(
      new Set([mine, hers]),
    );
  });

  it("a man's interest alone opens nothing; her later yes opens it, with her as opener", async () => {
    const { viewer: man, other: woman } = await pair();
    const his = await addIntro(man, woman, "new");
    const hers = await addIntro(woman, man, "new");

    const first = await decide(man, his, "interested");
    expect(first).toEqual({ status: "interest_saved", reason: "waiting" });
    expect(await chatsBetween(man, woman)).toBe(0);

    const second = await decide(woman, hers, "interested");
    expect(second.status).toBe("opened");
    expect(second.opener_id).toBe(woman);
    expect(await chatsBetween(man, woman)).toBe(1);
  });

  it("a woman's interest first, then his: opens on his click, she opens", async () => {
    const { viewer: man, other: woman } = await pair();
    const his = await addIntro(man, woman, "new");
    const hers = await addIntro(woman, man, "new");
    expect((await decide(woman, hers, "interested")).status).toBe(
      "interest_saved",
    );
    const out = await decide(man, his, "interested");
    expect(out.status).toBe("opened");
    expect(out.opener_id).toBe(woman);
  });

  it("two women: the one who said yes first opens", async () => {
    const { viewer: a, other: b } = await pair({
      viewer: "woman",
      other: "woman",
    });
    const ia = await addIntro(a, b, "new");
    const ib = await addIntro(b, a, "new");
    await decide(b, ib, "interested", {
      now: new Date("2026-11-18T09:00:00Z"),
    });
    const out = await decide(a, ia, "interested");
    expect(out.status).toBe("opened");
    expect(out.opener_id).toBe(b);
  });

  it("with the woman-first rule switched off, the earlier yes opens even for man-woman", async () => {
    const { viewer: man, other: woman } = await pair();
    const his = await addIntro(man, woman, "new");
    const hers = await addIntro(woman, man, "new");
    await decide(man, his, "interested", {
      now: new Date("2026-11-18T09:00:00Z"),
      womanOpens: false,
    });
    const out = await decide(woman, hers, "interested", { womanOpens: false });
    expect(out.status).toBe("opened");
    expect(out.opener_id).toBe(man);
  });

  it("a double click returns the same conversation and creates no second one", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    await addIntro(other, viewer, "interested");

    const first = await decide(viewer, mine, "interested");
    const second = await decide(viewer, mine, "interested");
    expect(first.status).toBe("opened");
    expect(second.status).toBe("already_open");
    expect(second.conversation_id).toBe(first.conversation_id);
    expect(await chatsBetween(viewer, other)).toBe(1);
  });

  it("both people answering at the same moment still gives one conversation", async () => {
    const { viewer: man, other: woman } = await pair();
    const his = await addIntro(man, woman, "new");
    const hers = await addIntro(woman, man, "new");

    const results = await Promise.all([
      decide(man, his, "interested"),
      decide(woman, hers, "interested"),
      decide(man, his, "interested"),
      decide(woman, hers, "interested"),
    ]);
    expect(await chatsBetween(man, woman)).toBe(1);
    const opened = results.filter((r) => r.status === "opened");
    expect(opened).toHaveLength(1);
    const ids = results
      .map((r) => r.conversation_id)
      .filter((id): id is string => Boolean(id));
    expect(new Set(ids).size).toBe(1);
  });

  it("the other person's answer is not changed by mine", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    const theirs = await addIntro(other, viewer, "interested");
    await decide(viewer, mine, "interested");
    expect((await introRow(theirs)).status).toBe("interested");
    expect((await introRow(mine)).status).toBe("interested");
  });

  it("after a chat is closed, the pair can be opened again by a new match", async () => {
    const { viewer, other } = await pair();
    await addChat(viewer, other, "closed");
    const mine = await addIntro(viewer, other, "new");
    await addIntro(other, viewer, "interested");
    expect((await decide(viewer, mine, "interested")).status).toBe("opened");
  });

  it("is all or nothing: if opening the chat fails, the answer is not saved either", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    await addIntro(other, viewer, "interested");
    await db.exec(`
      create function pg_temp.fail_insert() returns trigger language plpgsql as
        $$ begin raise exception 'simulated failure'; end $$;
      create trigger fail_chat_insert before insert on public.conversations
        for each row execute function pg_temp.fail_insert();
    `);
    try {
      expect(await decideError(viewer, mine, "interested")).toMatch(
        /simulated failure/,
      );
    } finally {
      await db.exec(`drop trigger fail_chat_insert on public.conversations`);
    }
    expect((await introRow(mine)).status).toBe("new");
    expect(await chatsBetween(viewer, other)).toBe(0);
    // And it works normally afterwards.
    expect((await decide(viewer, mine, "interested")).status).toBe("opened");
  });
});

// ---------------------------------------------------------------------------
describe("passing", () => {
  it("is silent: nothing changes for the other person and no chat opens", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new", { note: undefined });
    const theirs = await addIntro(other, viewer, "interested");
    const before = await introRow(theirs);

    expect(await decide(viewer, mine, "passed")).toEqual({ status: "passed" });
    expect(await introRow(theirs)).toEqual(before);
    expect((await introRow(mine)).status).toBe("passed");
    expect(await chatsBetween(viewer, other)).toBe(0);
  });

  it("gives the other person the same reply whether she passed or has not answered", async () => {
    const a = await pair();
    const b = await pair();
    const ia = await addIntro(a.viewer, a.other, "new");
    await addIntro(a.other, a.viewer, "passed");
    const ib = await addIntro(b.viewer, b.other, "new");
    await addIntro(b.other, b.viewer, "new");
    expect(await decide(a.viewer, ia, "interested")).toEqual(
      await decide(b.viewer, ib, "interested"),
    );
  });

  it("a pass is final and repeating it is harmless", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    await decide(viewer, mine, "passed");
    expect(await decide(viewer, mine, "passed")).toEqual({ status: "passed" });
    expect(await decideError(viewer, mine, "interested")).toMatch(
      /already_decided/,
    );
  });

  it("Interested is final too", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    await decide(viewer, mine, "interested");
    expect(await decideError(viewer, mine, "passed")).toMatch(
      /already_decided/,
    );
  });
});

// ---------------------------------------------------------------------------
describe("who may answer, and when", () => {
  it("refuses someone else's intro, and an unknown one, with the same error", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    const stranger = await member("man");
    const e1 = await decideError(stranger, mine, "interested");
    const e2 = await decideError(stranger, randomUUID(), "interested");
    expect(e1).toMatch(/intro_not_found/);
    expect(e2).toMatch(/intro_not_found/);
    expect((await introRow(mine)).status).toBe("new");
  });

  it("the candidate cannot answer the viewer's intro either", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    expect(await decideError(other, mine, "interested")).toMatch(
      /intro_not_found/,
    );
  });

  it("refuses an intro whose week is over", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    expect(
      await decideError(viewer, mine, "interested", { now: AFTER_EXPIRY }),
    ).toMatch(/intro_expired/);
    // One minute before the end it still works.
    expect(
      (
        await decide(viewer, mine, "interested", {
          now: new Date(AFTER_EXPIRY.getTime() - 60_000),
        })
      ).status,
    ).toBe("interest_saved");
  });

  it("refuses an intro marked expired", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "expired");
    expect(await decideError(viewer, mine, "interested")).toMatch(
      /intro_expired/,
    );
  });

  it("refuses a paused, suspended or unfinished viewer", async () => {
    const paused = await member("man", { paused: true });
    const other = await member("woman");
    const intro = await addIntro(paused, other, "new");
    expect(await decideError(paused, intro, "passed")).toMatch(
      /viewer_unavailable/,
    );
    await db.query(
      `update public.profiles set paused = false, suspended_at = now() where id = $1`,
      [paused],
    );
    expect(await decideError(paused, intro, "passed")).toMatch(
      /viewer_unavailable/,
    );
    await db.query(
      `update public.profiles set suspended_at = null, onboarding_completed_at = null where id = $1`,
      [paused],
    );
    expect(await decideError(paused, intro, "passed")).toMatch(
      /viewer_unavailable/,
    );
  });

  it("refuses a decision that is not interested or passed", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    expect(
      await actAs("service", async () => {
        try {
          await db.query(`select public.decide_intro($1, $2, 'maybe')`, [
            viewer,
            mine,
          ]);
          return "no error";
        } catch (e) {
          return (e as Error).message;
        }
      }),
    ).toMatch(/bad_decision/);
  });
});

// ---------------------------------------------------------------------------
describe("the note", () => {
  it("is saved with Interested, trimmed, and dropped on a pass", async () => {
    const a = await pair();
    const ia = await addIntro(a.viewer, a.other, "new");
    await decide(a.viewer, ia, "interested", { note: "  Hello there  " });
    expect((await introRow(ia)).note).toBe("Hello there");

    const b = await pair();
    const ib = await addIntro(b.viewer, b.other, "new");
    await decide(b.viewer, ib, "passed", { note: "ignored" });
    expect((await introRow(ib)).note).toBeNull();
  });

  it("refuses an over-long note or one with control characters", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    expect(
      await decideError(viewer, mine, "interested", { note: "x".repeat(141) }),
    ).toMatch(/bad_note/);
    expect(
      await decideError(viewer, mine, "interested", { note: "hi\u0007there" }),
    ).toMatch(/bad_note/);
    expect((await introRow(mine)).status).toBe("new");
  });

  it("stays private until a chat exists, then both can read both notes", async () => {
    const { viewer: man, other: woman } = await pair();
    const his = await addIntro(man, woman, "new");
    const hers = await addIntro(woman, man, "new");
    await decide(man, his, "interested", { note: "his note" });

    // She cannot read his intro row, so she cannot see his note.
    const peek = await actAs(woman, () =>
      db.query(`select note from public.intros where viewer_id = $1`, [man]),
    );
    expect(peek.rows).toHaveLength(0);

    const out = await decide(woman, hers, "interested", { note: "her note" });
    const read = (who: string) =>
      actAs(who, () =>
        db.query<{ author_id: string; note: string }>(
          `select * from public.conversation_intro_notes($1)`,
          [out.conversation_id],
        ),
      );
    const forHer = await read(woman);
    expect(forHer.rows.map((r) => r.note).sort()).toEqual([
      "her note",
      "his note",
    ]);
    const forHim = await read(man);
    expect(forHim.rows).toHaveLength(2);

    const outsider = await member("man");
    expect((await read(outsider)).rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("the chat cap", () => {
  it("blocks Interested at 3 open chats, saves nothing, and still allows Pass", async () => {
    const { viewer, other } = await pair();
    await fillChats(viewer, 3);
    const mine = await addIntro(viewer, other, "new");
    await addIntro(other, viewer, "interested");

    expect(await decide(viewer, mine, "interested")).toEqual({
      status: "viewer_at_cap",
    });
    expect((await introRow(mine)).status).toBe("new");
    expect(await chatsBetween(viewer, other)).toBe(0);
    expect(await decide(viewer, mine, "passed")).toEqual({ status: "passed" });
  });

  it("gives the same reply at the cap whether or not the other person is interested", async () => {
    const a = await pair();
    const b = await pair();
    await fillChats(a.viewer, 3);
    await fillChats(b.viewer, 3);
    const ia = await addIntro(a.viewer, a.other, "new");
    await addIntro(a.other, a.viewer, "interested");
    const ib = await addIntro(b.viewer, b.other, "new");
    await addIntro(b.other, b.viewer, "passed");
    expect(await decide(a.viewer, ia, "interested")).toEqual(
      await decide(b.viewer, ib, "interested"),
    );
  });

  it("kept chats count toward the cap, closed and expired ones do not", async () => {
    const { viewer, other } = await pair();
    await addChat(viewer, await member(null), "kept");
    await addChat(viewer, await member(null), "kept");
    await addChat(viewer, await member(null), "closed");
    await addChat(viewer, await member(null), "expired");
    const mine = await addIntro(viewer, other, "new");
    await addIntro(other, viewer, "interested");
    expect((await decide(viewer, mine, "interested")).status).toBe("opened");
  });

  it("a Plus member can hold 5 chats, a lapsed Plus member only 3", async () => {
    const plus = await member("man", { plus: true });
    const woman = await member("woman");
    await fillChats(plus, 4);
    const intro = await addIntro(plus, woman, "new");
    await addIntro(woman, plus, "interested");
    expect((await decide(plus, intro, "interested")).status).toBe("opened");
    // Now 5 of 5.
    const woman2 = await member("woman");
    const intro2 = await addIntro(plus, woman2, "new");
    await addIntro(woman2, plus, "interested");
    expect((await decide(plus, intro2, "interested")).status).toBe(
      "viewer_at_cap",
    );

    const lapsed = await member("man");
    await db.query(
      `update public.profiles set plus_until = '2026-11-01T00:00:00Z' where id = $1`,
      [lapsed],
    );
    await fillChats(lapsed, 3);
    const w3 = await member("woman");
    const intro3 = await addIntro(lapsed, w3, "new");
    expect((await decide(lapsed, intro3, "interested")).status).toBe(
      "viewer_at_cap",
    );
  });

  it("the other person at their cap: interest saved, no chat, then it opens when they have room", async () => {
    const { viewer: man, other: woman } = await pair();
    const hers = await addIntro(woman, man, "interested");
    const his = await addIntro(man, woman, "new");
    await fillChats(woman, 3);

    // Neutral reply, same as simply waiting.
    expect(await decide(man, his, "interested")).toEqual({
      status: "interest_saved",
      reason: "other_at_cap",
    });
    expect(await chatsBetween(man, woman)).toBe(0);
    expect((await introRow(his)).status).toBe("interested");

    // She is still full: a retry changes nothing.
    expect((await decide(man, his, "interested")).status).toBe(
      "interest_saved",
    );

    // One of her chats closes. Either person repeating Interested opens it.
    await db.query(
      `update public.conversations set status = 'closed'
        where id = (select id from public.conversations
                     where user_a = $1 and status = 'open' limit 1)`,
      [woman],
    );
    const out = await decide(woman, hers, "interested");
    expect(out.status).toBe("opened");
    expect(out.opener_id).toBe(woman);
    expect(await chatsBetween(man, woman)).toBe(1);
  });

  it("two matches racing for the last slot: only one gets it", async () => {
    const man = await member("man");
    await fillChats(man, 2);
    const w1 = await member("woman");
    const w2 = await member("woman");
    const i1 = await addIntro(man, w1, "new");
    const i2 = await addIntro(man, w2, "new");
    await addIntro(w1, man, "interested");
    await addIntro(w2, man, "interested");

    const results = await Promise.all([
      decide(man, i1, "interested"),
      decide(man, i2, "interested"),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(["opened", "viewer_at_cap"]);
    const chats = await db.query<{ n: string }>(
      `select count(*) as n from public.conversations
        where status in ('open','kept') and $1 in (user_a, user_b)`,
      [man],
    );
    expect(Number(chats.rows[0].n)).toBe(3);
  });

  it("opens nothing when the pair is blocked, and says so neutrally", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    await addIntro(other, viewer, "interested");
    await db.query(
      `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
      [viewer, other],
    );
    expect(await decide(viewer, mine, "interested")).toEqual({
      status: "interest_saved",
      reason: "unavailable",
    });
    expect(await chatsBetween(viewer, other)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("who can call what, and what they can see", () => {
  it("signed-in users and visitors cannot call decide_intro at all", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    for (const who of [viewer, other, "anon"] as const) {
      await expect(
        actAs(who, () =>
          db.query(`select public.decide_intro($1, $2, 'passed')`, [
            viewer,
            mine,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
    expect((await introRow(mine)).status).toBe("new");
  });

  it("users cannot write to intros or conversations directly", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    await expect(
      actAs(viewer, () =>
        db.query(
          `update public.intros set status = 'interested' where id = $1`,
          [mine],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(viewer, () =>
        db.query(
          `insert into public.conversations (user_a, user_b, opener_id, window_ends_at)
           values ($1, $2, $1, now())`,
          [viewer, other],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("a user cannot read the other side's intro row or status", async () => {
    const { viewer, other } = await pair();
    const mine = await addIntro(viewer, other, "new");
    const theirs = await addIntro(other, viewer, "interested", {
      note: "secret",
    });
    const seen = await actAs(viewer, () =>
      db.query<{ id: string }>(`select id from public.intros`),
    );
    expect(seen.rows.map((r) => r.id)).toContain(mine);
    expect(seen.rows.map((r) => r.id)).not.toContain(theirs);

    const direct = await actAs(viewer, () =>
      db.query(`select * from public.intros where id = $1`, [theirs]),
    );
    expect(direct.rows).toHaveLength(0);
  });

  it("my_shortlist returns only my own intros, no score, and stamps the first view once", async () => {
    const me = await member("woman");
    const a = await member("man");
    const b = await member("man");
    const c = await member("man");
    // A newer drop that only this test uses.
    const d = await db.query<{ id: string }>(
      `insert into public.drops (week_start) values ('2026-11-23') returning id`,
    );
    const newDrop = d.rows[0].id;
    for (const [viewer, cand] of [
      [me, a],
      [me, b],
      [c, me],
    ]) {
      await db.query(
        `insert into public.intros (drop_id, viewer_id, candidate_id, score, reasons)
         values ($1, $2, $3, 0.9, '["Both in Pune"]')`,
        [newDrop, viewer, cand],
      );
    }
    type Shortlist = {
      week_start: string;
      intros: Record<string, unknown>[];
    };
    const read = () =>
      actAs(me, () =>
        db.query<{ r: Shortlist }>(`select public.my_shortlist() as r`),
      );

    const first = (await read()).rows[0].r;
    expect(first.week_start).toBe("2026-11-23");
    expect(first.intros).toHaveLength(2);
    expect(first.intros.map((i) => i.candidate_id).sort()).toEqual(
      [a, b].sort(),
    );
    expect(first.intros.every((i) => i.first_view === true)).toBe(true);
    expect(Object.keys(first.intros[0]).sort()).toEqual(
      ["candidate_id", "first_view", "id", "note", "reasons", "status"].sort(),
    );

    const second = (await read()).rows[0].r;
    expect(second.intros.every((i) => i.first_view === false)).toBe(true);

    // Clean up so the newer drop does not affect other tests.
    await db.query(`delete from public.drops where id = $1`, [newDrop]);
  });

  it("my_shortlist needs a signed-in user", async () => {
    await expect(
      actAs("anon", () => db.query(`select public.my_shortlist()`)),
    ).rejects.toThrow(/permission denied|not_signed_in/);
  });
});
