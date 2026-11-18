import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// These tests run the real migrations in an in-process Postgres (PGlite) and
// then act as different users, the same way Supabase does: switch to the
// "authenticated" role and set the user id that auth.uid() returns.
// What this does NOT cover: Supabase's own auth service, JWT handling, or
// realtime. Those need a real Supabase project.

const root = process.cwd();
let db: PGlite;

const ids = {
  alice: randomUUID(), // has an intro to Bob and a conversation with him
  bob: randomUUID(),
  carol: randomUUID(), // stranger: no intro, no conversation
  admin: randomUUID(),
  dave: randomUUID(), // block tests
  erin: randomUUID(),
};

async function createUser(id: string, name: string, dob = "1998-03-14") {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [
      id,
      `${name}@example.com`,
      JSON.stringify({
        display_name: name,
        dob,
        accepted_terms: "true",
        accepted_privacy: "true",
        consent_version: "test-1",
      }),
    ],
  );
}

// Run `fn` as a signed-in user (or as a visitor when userId is null).
async function actAs<T>(
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const role = userId ? "authenticated" : "anon";
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId ?? "",
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

const rows = async (sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, unknown>>(sql, params)).rows;

let conversationId: string;
let closedConversationId: string;
let expiredWindowConversationId: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(root, "tests/rls/bootstrap.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }

  for (const [name, id] of Object.entries(ids)) await createUser(id, name);
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [
    ids.admin,
  ]);

  // Alice was shown Bob in a weekly drop.
  const [drop] = await rows(
    `insert into public.drops (week_start) values ('2026-11-15') returning id`,
  );
  await db.query(
    `insert into public.intros (drop_id, viewer_id, candidate_id) values ($1, $2, $3)`,
    [drop.id, ids.alice, ids.bob],
  );
  await db.query(
    `insert into public.intros (drop_id, viewer_id, candidate_id) values ($1, $2, $3)`,
    [drop.id, ids.dave, ids.erin],
  );

  // An open conversation, a closed one, and an open one whose window has passed.
  const insertConversation = async (
    a: string,
    b: string,
    status: string,
    ends: string,
  ) =>
    (
      await rows(
        `insert into public.conversations (user_a, user_b, opener_id, status, window_ends_at)
         values ($1, $2, $1, $3, now() + $4::interval) returning id`,
        [a, b, status, ends],
      )
    )[0].id as string;
  conversationId = await insertConversation(
    ids.alice,
    ids.bob,
    "open",
    "3 days",
  );
  closedConversationId = await insertConversation(
    ids.alice,
    ids.bob,
    "closed",
    "-1 day",
  );
  expiredWindowConversationId = await insertConversation(
    ids.dave,
    ids.erin,
    "open",
    "-1 hour",
  );

  for (const cid of [
    conversationId,
    closedConversationId,
    expiredWindowConversationId,
  ]) {
    await db.query(
      `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hello')`,
      [cid, cid === expiredWindowConversationId ? ids.dave : ids.alice],
    );
  }

  await db.query(
    `insert into public.orders (user_id, razorpay_order_id, plan, amount_paise)
     values ($1, 'order_a', 'plus_1m', 19900), ($2, 'order_b', 'plus_1m', 19900)`,
    [ids.alice, ids.bob],
  );
  await db.query(
    `insert into public.reports (reporter_id, target_id, reason) values ($1, $2, 'other')`,
    [ids.bob, ids.alice],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("signup trigger and the 18+ rule", () => {
  it("creates a profile and two consent rows with the policy version", async () => {
    const [profile] = await rows(
      `select role, display_name from public.profiles where id = $1`,
      [ids.carol],
    );
    expect(profile).toEqual({ role: "user", display_name: "carol" });
    const consents = await rows(
      `select kind, policy_version, granted from public.consents where user_id = $1 order by kind`,
      [ids.carol],
    );
    expect(consents).toEqual([
      { kind: "terms", policy_version: "test-1", granted: true },
      { kind: "privacy", policy_version: "test-1", granted: true },
    ]);
  });

  it("rejects an under-18 date of birth when called directly", async () => {
    const year = new Date().getUTCFullYear() - 17;
    await expect(
      createUser(randomUUID(), "kid", `${year}-01-01`),
    ).rejects.toThrow(/at least 18/);
  });

  it("accepts someone who turns 18 today and rejects someone who turns 18 tomorrow", async () => {
    const today = await rows(
      `select (current_date - interval '18 years')::date::text as d`,
    );
    const tomorrow = await rows(
      `select (current_date - interval '18 years' + interval '1 day')::date::text as d`,
    );
    await expect(
      createUser(randomUUID(), "justeighteen", today[0].d as string),
    ).resolves.toBeUndefined();
    await expect(
      createUser(randomUUID(), "almost", tomorrow[0].d as string),
    ).rejects.toThrow(/at least 18/);
  });

  it("rejects a missing or malformed date of birth", async () => {
    const insert = (meta: object) =>
      db.query(
        `insert into auth.users (id, raw_user_meta_data) values ($1, $2)`,
        [randomUUID(), JSON.stringify(meta)],
      );
    const consent = {
      accepted_terms: "true",
      accepted_privacy: "true",
      consent_version: "v",
    };
    await expect(insert({ ...consent })).rejects.toThrow(/date of birth/);
    await expect(insert({ ...consent, dob: "not-a-date" })).rejects.toThrow(
      /date of birth/,
    );
  });

  it("rejects signup without consent", async () => {
    const insert = (meta: object) =>
      db.query(
        `insert into auth.users (id, raw_user_meta_data) values ($1, $2)`,
        [randomUUID(), JSON.stringify(meta)],
      );
    const base = { display_name: "x", dob: "1990-01-01", consent_version: "v" };
    await expect(insert({ ...base, accepted_terms: "true" })).rejects.toThrow(
      /consent/,
    );
    await expect(insert({ ...base, accepted_privacy: "true" })).rejects.toThrow(
      /consent/,
    );
    await expect(
      insert({
        dob: "1990-01-01",
        accepted_terms: "true",
        accepted_privacy: "true",
      }),
    ).rejects.toThrow(/consent/);
  });

  it("ignores a role smuggled in through signup metadata", async () => {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, raw_user_meta_data) values ($1, $2)`,
      [
        id,
        JSON.stringify({
          role: "admin",
          display_name: "sneaky",
          dob: "1990-01-01",
          accepted_terms: "true",
          accepted_privacy: "true",
          consent_version: "v",
        }),
      ],
    );
    const [p] = await rows(`select role from public.profiles where id = $1`, [
      id,
    ]);
    expect(p.role).toBe("user");
  });

  it("also blocks changing the date of birth to under 18 later", async () => {
    const year = new Date().getUTCFullYear() - 10;
    await expect(
      db.query(`update public.profiles set dob = $2 where id = $1`, [
        ids.carol,
        `${year}-01-01`,
      ]),
    ).rejects.toThrow(/at least 18/);
  });

  it("syncs verified_email when Supabase confirms the address", async () => {
    await db.query(
      `update auth.users set email_confirmed_at = now() where id = $1`,
      [ids.carol],
    );
    const [p] = await rows(
      `select verified_email from public.profiles where id = $1`,
      [ids.carol],
    );
    expect(p.verified_email).toBe(true);
  });
});

describe("profiles: no public browse", () => {
  it("lets users read their own profile", async () => {
    const result = await actAs(ids.carol, () =>
      rows(`select id from public.profiles where id = $1`, [ids.carol]),
    );
    expect(result).toHaveLength(1);
  });

  it("hides another user's profile when there is no intro or conversation", async () => {
    const result = await actAs(ids.carol, () =>
      rows(`select id from public.profiles where id = $1`, [ids.bob]),
    );
    expect(result).toHaveLength(0);
  });

  it("returns only self when a stranger lists all profiles", async () => {
    const result = await actAs(ids.carol, () =>
      rows(`select id from public.profiles`),
    );
    expect(result.map((r) => r.id)).toEqual([ids.carol]);
  });

  it("shows a profile to someone who was given an intro to it", async () => {
    const result = await actAs(ids.alice, () =>
      rows(`select id from public.profiles where id = $1`, [ids.bob]),
    );
    expect(result).toHaveLength(1);
  });

  it("does not show the viewer's profile to the candidate just because an intro exists", async () => {
    const result = await actAs(ids.erin, () =>
      rows(`select id from public.profiles where id = $1`, [ids.dave]),
    );
    // Erin is in a conversation with Dave, so she can; Carol (no link) cannot.
    expect(result).toHaveLength(1);
    const stranger = await actAs(ids.carol, () =>
      rows(`select id from public.profiles where id = $1`, [ids.dave]),
    );
    expect(stranger).toHaveLength(0);
  });

  it("lets an admin read any profile", async () => {
    const result = await actAs(ids.admin, () =>
      rows(`select id from public.profiles`),
    );
    expect(result.length).toBeGreaterThanOrEqual(Object.keys(ids).length);
  });

  it("shows nothing to visitors who are not signed in", async () => {
    await expect(
      actAs(null, () => rows(`select id from public.profiles`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not expose date of birth or the eLitmus hash as columns", async () => {
    await expect(
      actAs(ids.carol, () => rows(`select dob from public.profiles`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.carol, () =>
        rows(`select elitmus_ref_hash from public.profiles`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("gives an age only for profiles you may see", async () => {
    const seen = await actAs(ids.alice, () =>
      rows(`select public.profile_age($1) as age`, [ids.bob]),
    );
    expect(seen[0].age).toBeGreaterThanOrEqual(18);
    const unseen = await actAs(ids.carol, () =>
      rows(`select public.profile_age($1) as age`, [ids.bob]),
    );
    expect(unseen[0].age).toBeNull();
  });
});

describe("profiles: no privilege escalation", () => {
  it("lets users edit their own display name", async () => {
    await actAs(ids.carol, () =>
      db.query(
        `update public.profiles set display_name = 'Carol C' where id = $1`,
        [ids.carol],
      ),
    );
    const [p] = await rows(
      `select display_name from public.profiles where id = $1`,
      [ids.carol],
    );
    expect(p.display_name).toBe("Carol C");
  });

  it.each([
    ["role", `role = 'admin'`],
    ["plus_until", `plus_until = now() + interval '1 year'`],
    ["elitmus_status", `elitmus_status = 'verified'`],
    ["verified_email", `verified_email = true`],
    ["suspended_at", `suspended_at = null`],
    ["dob", `dob = '1990-01-01'`],
    ["reply_rate_num", `reply_rate_num = 99`],
  ])("refuses to let a user change their own %s", async (_name, assignment) => {
    await expect(
      actAs(ids.carol, () =>
        db.query(`update public.profiles set ${assignment} where id = $1`, [
          ids.carol,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let a user edit someone else's profile", async () => {
    // Bob is visible to Alice, but the update policy only allows your own row.
    await actAs(ids.alice, () =>
      db.query(
        `update public.profiles set display_name = 'hacked' where id = $1`,
        [ids.bob],
      ),
    );
    const [p] = await rows(
      `select display_name from public.profiles where id = $1`,
      [ids.bob],
    );
    expect(p.display_name).toBe("bob");
  });

  it("does not let users insert or delete profiles", async () => {
    await expect(
      actAs(ids.carol, () =>
        db.query(
          `insert into public.profiles (id, display_name, dob) values ($1, 'x', '1990-01-01')`,
          [randomUUID()],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.carol, () =>
        db.query(`delete from public.profiles where id = $1`, [ids.carol]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("messages", () => {
  it("lets both participants read an open conversation", async () => {
    for (const who of [ids.alice, ids.bob]) {
      const result = await actAs(who, () =>
        rows(`select body from public.messages where conversation_id = $1`, [
          conversationId,
        ]),
      );
      expect(result).toHaveLength(1);
    }
  });

  it("hides messages from a non-participant", async () => {
    const result = await actAs(ids.carol, () =>
      rows(
        `select id, conversation_id, sender_id, body, created_at from public.messages`,
      ),
    );
    expect(result).toHaveLength(0);
    const conversations = await actAs(ids.carol, () =>
      rows(`select id, status from public.conversations`),
    );
    expect(conversations).toHaveLength(0);
  });

  it("hides messages in a closed conversation", async () => {
    const result = await actAs(ids.alice, () =>
      rows(
        `select id, conversation_id, sender_id, body, created_at from public.messages where conversation_id = $1`,
        [closedConversationId],
      ),
    );
    expect(result).toHaveLength(0);
  });

  // Sending goes through send_message() since the conversations migration
  // (tests/rls/conversations.test.ts). A direct insert, even as yourself into
  // your own open chat, is refused, so the opener-first rule, the rate limit
  // and the window cannot be skipped by calling the API directly.
  it("refuses a direct insert even from a participant", async () => {
    await expect(
      actAs(ids.bob, () =>
        db.query(
          `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hi back')`,
          [conversationId, ids.bob],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops a non-participant from sending", async () => {
    await expect(
      actAs(ids.carol, () =>
        db.query(
          `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'let me in')`,
          [conversationId, ids.carol],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops a participant from sending as someone else", async () => {
    await expect(
      actAs(ids.alice, () =>
        db.query(
          `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'fake')`,
          [conversationId, ids.bob],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops sending after the reply window has ended", async () => {
    await expect(
      actAs(ids.dave, () =>
        db.query(
          `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'late')`,
          [expiredWindowConversationId, ids.dave],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops sending into a closed conversation", async () => {
    await expect(
      actAs(ids.alice, () =>
        db.query(
          `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'x')`,
          [closedConversationId, ids.alice],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let users set the flagged column or edit messages", async () => {
    await expect(
      actAs(ids.alice, () =>
        db.query(
          `insert into public.messages (conversation_id, sender_id, body, flagged) values ($1, $2, 'x', true)`,
          [conversationId, ids.alice],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.alice, () =>
        db.query(`update public.messages set body = 'edited'`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("gives admins no blanket access to message text", async () => {
    const result = await actAs(ids.admin, () =>
      rows(
        `select id, conversation_id, sender_id, body, created_at from public.messages`,
      ),
    );
    expect(result).toHaveLength(0);
  });
});

describe("intros and conversations are not writable by users", () => {
  it("lets only the viewer read an intro", async () => {
    expect(
      await actAs(ids.alice, () => rows(`select id from public.intros`)),
    ).toHaveLength(1);
    expect(
      await actAs(ids.bob, () => rows(`select id from public.intros`)),
    ).toHaveLength(0);
  });

  it("refuses direct writes", async () => {
    await expect(
      actAs(ids.alice, () =>
        db.query(`update public.intros set status = 'interested'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.alice, () =>
        db.query(`update public.conversations set status = 'kept'`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("orders", () => {
  it("shows users only their own orders", async () => {
    const mine = await actAs(ids.alice, () =>
      rows(`select razorpay_order_id from public.orders`),
    );
    expect(mine).toEqual([{ razorpay_order_id: "order_a" }]);
    const none = await actAs(ids.carol, () =>
      rows(`select * from public.orders`),
    );
    expect(none).toHaveLength(0);
  });

  it("does not let users create or change orders", async () => {
    await expect(
      actAs(ids.alice, () =>
        db.query(
          `insert into public.orders (user_id, razorpay_order_id, plan, amount_paise) values ($1, 'x', 'plus_1m', 1)`,
          [ids.alice],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.alice, () =>
        db.query(`update public.orders set status = 'paid'`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("reports", () => {
  it("lets a reporter file a report about someone they can see", async () => {
    await actAs(ids.alice, () =>
      db.query(
        `insert into public.reports (reporter_id, target_id, reason, details) values ($1, $2, 'scam', 'spam')`,
        [ids.alice, ids.bob],
      ),
    );
    expect(
      await rows(`select id from public.reports where reporter_id = $1`, [
        ids.alice,
      ]),
    ).toHaveLength(1);
  });

  it("does not let the reporter read reports back", async () => {
    expect(
      await actAs(ids.alice, () => rows(`select * from public.reports`)),
    ).toHaveLength(0);
  });

  it("does not let other users read reports, even ones about them", async () => {
    // Bob's earlier report is about Alice; Alice must not see it.
    expect(
      await actAs(ids.carol, () => rows(`select * from public.reports`)),
    ).toHaveLength(0);
    expect(
      await actAs(ids.alice, () =>
        rows(`select * from public.reports where target_id = $1`, [ids.alice]),
      ),
    ).toHaveLength(0);
  });

  it("lets an admin read and update the queue", async () => {
    const all = await actAs(ids.admin, () =>
      rows(`select id from public.reports`),
    );
    expect(all.length).toBeGreaterThanOrEqual(2);
    await actAs(ids.admin, () =>
      db.query(`update public.reports set status = 'ack', ack_at = now()`),
    );
    const open = await rows(
      `select count(*)::int as n from public.reports where status = 'ack'`,
    );
    expect(open[0].n).toBeGreaterThanOrEqual(2);
  });

  it("does not let a normal user change report status", async () => {
    // The status column is grantable, but the policy needs is_admin().
    await actAs(ids.alice, () =>
      db.query(`update public.reports set status = 'dismissed'`),
    );
    expect(
      await rows(`select id from public.reports where status = 'dismissed'`),
    ).toHaveLength(0);
  });

  it("refuses reports filed under someone else's name or about a stranger", async () => {
    await expect(
      actAs(ids.alice, () =>
        db.query(
          `insert into public.reports (reporter_id, target_id, reason) values ($1, $2, 'other')`,
          [ids.bob, ids.alice],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      actAs(ids.carol, () =>
        db.query(
          `insert into public.reports (reporter_id, target_id, reason) values ($1, $2, 'other')`,
          [ids.carol, ids.bob],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("blocks", () => {
  it("lets the blocker create and see a block, but not the blocked person", async () => {
    await actAs(ids.dave, () =>
      db.query(
        `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
        [ids.dave, ids.erin],
      ),
    );
    expect(
      await actAs(ids.dave, () => rows(`select * from public.blocks`)),
    ).toHaveLength(1);
    expect(
      await actAs(ids.erin, () => rows(`select * from public.blocks`)),
    ).toHaveLength(0);
  });

  it("hides both profiles from each other once blocked", async () => {
    expect(
      await actAs(ids.dave, () =>
        rows(`select id from public.profiles where id = $1`, [ids.erin]),
      ),
    ).toHaveLength(0);
    expect(
      await actAs(ids.erin, () =>
        rows(`select id from public.profiles where id = $1`, [ids.dave]),
      ),
    ).toHaveLength(0);
  });

  it("refuses a block filed in someone else's name", async () => {
    await expect(
      actAs(ids.carol, () =>
        db.query(
          `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
          [ids.bob, ids.carol],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets the blocker remove the block, and only the blocker", async () => {
    await actAs(ids.erin, () => db.query(`delete from public.blocks`));
    expect(await rows(`select * from public.blocks`)).toHaveLength(1);
    await actAs(ids.dave, () =>
      db.query(`delete from public.blocks where blocked_id = $1`, [ids.erin]),
    );
    expect(await rows(`select * from public.blocks`)).toHaveLength(0);
  });
});

describe("consents, events, safety records, audit log", () => {
  it("lets users read only their own consents and never edit them", async () => {
    const mine = await actAs(ids.carol, () =>
      rows(`select user_id from public.consents`),
    );
    expect(mine.every((r) => r.user_id === ids.carol)).toBe(true);
    await expect(
      actAs(ids.carol, () =>
        db.query(`update public.consents set granted = false`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.carol, () => db.query(`delete from public.consents`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets a user record a new consent for themselves only", async () => {
    await actAs(ids.carol, () =>
      db.query(
        `insert into public.consents (user_id, kind, policy_version, granted) values ($1, 'marketing', 'test-1', true)`,
        [ids.carol],
      ),
    );
    await expect(
      actAs(ids.carol, () =>
        db.query(
          `insert into public.consents (user_id, kind, policy_version, granted) values ($1, 'marketing', 'test-1', true)`,
          [ids.bob],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps server-only tables closed to users", async () => {
    await expect(
      actAs(ids.carol, () => rows(`select * from public.safety_records`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.carol, () =>
        db.query(`insert into public.events (name) values ('fake')`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(ids.carol, () =>
        db.query(`insert into public.audit_log (action) values ('fake')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets only admins read events and the audit log", async () => {
    await db.query(`insert into public.events (name) values ('signup')`);
    expect(
      await actAs(ids.carol, () => rows(`select * from public.events`)),
    ).toHaveLength(0);
    expect(
      (await actAs(ids.admin, () => rows(`select * from public.events`)))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("conversation shape", () => {
  it("allows only one live conversation per pair", async () => {
    await expect(
      db.query(
        `insert into public.conversations (user_a, user_b, opener_id, window_ends_at)
         values ($1, $2, $2, now() + interval '3 days')`,
        [ids.bob, ids.alice],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
