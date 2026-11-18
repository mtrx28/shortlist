import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLANS, SECOND_LOOK } from "@/config/plans";
import { SHORTLIST_CONFIG } from "@/config/shortlist";

// The money and entitlement functions against a real Postgres (PGlite):
// grant_plus (idempotent, stacking, refuses the wrong user/amount/currency),
// fail_order, revoke_plus, grant_demo_plus, the second look functions, and the
// row level security around orders and plus_until. PGlite has one connection,
// so repeated calls are sequential; the real parallel race is tested against
// the local stack in tests/integration/payments.test.ts.

const root = process.cwd();
let db: PGlite;

const DAY = 24 * 3600 * 1000;
const NOW = new Date();

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

let orderCounter = 0;
async function makeOrder(
  user: string | null,
  plan: "plus_1m" | "plus_3m" = "plus_1m",
  extra: { days?: number | null; status?: string } = {},
) {
  const providerOrderId = `order_test_${++orderCounter}_${randomUUID().slice(0, 6)}`;
  await db.query(
    `insert into public.orders
       (user_id, razorpay_order_id, plan, amount_paise, status, days, provider, razorpay_payment_id)
     values ($1, $2, $3, $4, $5, $6, 'simulated', $7)`,
    [
      user,
      providerOrderId,
      plan,
      PLANS[plan].amountPaise,
      extra.status ?? "created",
      extra.days === undefined ? PLANS[plan].days : extra.days,
      extra.status === "paid" ? `pay_pre_${orderCounter}` : null,
    ],
  );
  return providerOrderId;
}

type Grant = {
  result: string;
  plus_until?: string | null;
  same_payment?: boolean;
};

async function grant(
  orderId: string,
  paymentId: string,
  o: {
    amount?: number | null;
    currency?: string | null;
    user?: string | null;
    source?: string;
    now?: Date;
  } = {},
): Promise<Grant> {
  const r = await actAs("service", () =>
    db.query<{ r: Grant }>(
      `select public.grant_plus($1, $2, $3, $4, $5, $6, $7::timestamptz) as r`,
      [
        orderId,
        paymentId,
        o.amount ?? null,
        o.currency ?? null,
        o.user ?? null,
        o.source ?? "callback",
        (o.now ?? NOW).toISOString(),
      ],
    ),
  );
  return r.rows[0].r;
}

const plusUntil = async (user: string) =>
  (
    await db.query<{ p: string | null }>(
      `select plus_until as p from public.profiles where id = $1`,
      [user],
    )
  ).rows[0].p;

const order = async (providerOrderId: string) =>
  (
    await db.query<{
      status: string;
      razorpay_payment_id: string | null;
      granted_until: string | null;
    }>(
      `select status, razorpay_payment_id, granted_until from public.orders where razorpay_order_id = $1`,
      [providerOrderId],
    )
  ).rows[0];

const count = async (sql: string, params: unknown[] = []) =>
  Number(
    (
      await db.query<{ n: string }>(
        `select count(*) as n from (${sql}) x`,
        params,
      )
    ).rows[0].n,
  );

const ms = (v: string | null) => new Date(v as string).getTime();

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

describe("grant_plus", () => {
  it("grants Plus once, marks the order paid and writes an event", async () => {
    const user = await createUser("buyer");
    const o = await makeOrder(user);
    const out = await grant(o, "pay_1", { user });
    expect(out.result).toBe("granted");
    expect(ms(out.plus_until!)).toBe(NOW.getTime() + 30 * DAY);
    expect(ms(await plusUntil(user))).toBe(NOW.getTime() + 30 * DAY);
    expect(await order(o)).toMatchObject({
      status: "paid",
      razorpay_payment_id: "pay_1",
    });
    expect(
      await count(
        `select 1 from public.events where user_id = $1 and name = 'plus_granted'`,
        [user],
      ),
    ).toBe(1);
  });

  it("is a no-op the second time, and for a different payment id on the same order", async () => {
    const user = await createUser("repeat");
    const o = await makeOrder(user);
    await grant(o, "pay_r1", { user });
    const first = await plusUntil(user);

    const again = await grant(o, "pay_r1", { user, source: "webhook" });
    expect(again.result).toBe("already_granted");
    expect(again.same_payment).toBe(true);
    const other = await grant(o, "pay_r2", { source: "webhook" });
    expect(other.result).toBe("already_granted");
    expect(other.same_payment).toBe(false);

    expect(await plusUntil(user)).toEqual(first);
    expect((await order(o)).razorpay_payment_id).toBe("pay_r1");
    expect(
      await count(
        `select 1 from public.events where user_id = $1 and name = 'plus_granted'`,
        [user],
      ),
    ).toBe(1);
  });

  it("ten repeated calls grant exactly once", async () => {
    const user = await createUser("ten");
    const o = await makeOrder(user);
    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      results.push((await grant(o, "pay_ten", { user })).result);
    }
    expect(results.filter((r) => r === "granted")).toHaveLength(1);
    expect(ms(await plusUntil(user))).toBe(NOW.getTime() + 30 * DAY);
  });

  it("adds new time to the end of Plus that is still running", async () => {
    const user = await createUser("stack");
    const ends = new Date(NOW.getTime() + 10 * DAY);
    await db.query(`update public.profiles set plus_until = $2 where id = $1`, [
      user,
      ends.toISOString(),
    ]);
    const o = await makeOrder(user, "plus_3m");
    await grant(o, "pay_stack", { user });
    expect(ms(await plusUntil(user))).toBe(ends.getTime() + 90 * DAY);
  });

  it("starts from now when Plus has already run out", async () => {
    const user = await createUser("lapsed");
    await db.query(`update public.profiles set plus_until = $2 where id = $1`, [
      user,
      new Date(NOW.getTime() - 5 * DAY).toISOString(),
    ]);
    const o = await makeOrder(user, "plus_1m");
    await grant(o, "pay_lapsed", { user });
    expect(ms(await plusUntil(user))).toBe(NOW.getTime() + 30 * DAY);
  });

  it("two purchases stack one after the other", async () => {
    const user = await createUser("two");
    const a = await makeOrder(user, "plus_1m");
    const b = await makeOrder(user, "plus_3m");
    await grant(a, "pay_two_a", { user });
    await grant(b, "pay_two_b", { user });
    expect(ms(await plusUntil(user))).toBe(NOW.getTime() + 120 * DAY);
  });

  it("falls back to the plan length when an old order has no days", async () => {
    const user = await createUser("nodays");
    const o = await makeOrder(user, "plus_3m", { days: null });
    await grant(o, "pay_nodays", { user });
    expect(ms(await plusUntil(user))).toBe(NOW.getTime() + 90 * DAY);
  });

  it("refuses another member's order, a wrong amount and a wrong currency", async () => {
    const owner = await createUser("owner");
    const thief = await createUser("thief");
    const o = await makeOrder(owner);

    expect((await grant(o, "pay_x", { user: thief })).result).toBe(
      "wrong_user",
    );
    expect(
      (await grant(o, "pay_x", { amount: PLANS.plus_1m.amountPaise - 1 }))
        .result,
    ).toBe("amount_mismatch");
    expect((await grant(o, "pay_x", { currency: "USD" })).result).toBe(
      "currency_mismatch",
    );
    expect(await order(o)).toMatchObject({ status: "created" });
    expect(await plusUntil(owner)).toBeNull();
    expect(await plusUntil(thief)).toBeNull();
  });

  it("answers not_found for an unknown order and order_orphaned for a deleted owner", async () => {
    expect((await grant("order_nope", "pay_n")).result).toBe("not_found");
    const o = await makeOrder(null);
    expect((await grant(o, "pay_orphan")).result).toBe("order_orphaned");
  });

  it("will not use one payment id for two orders", async () => {
    const user = await createUser("conflict");
    const a = await makeOrder(user);
    const b = await makeOrder(user);
    expect((await grant(a, "pay_same", { user })).result).toBe("granted");
    const before = await plusUntil(user);
    expect((await grant(b, "pay_same", { user })).result).toBe(
      "payment_conflict",
    );
    expect((await order(b)).status).toBe("created");
    expect(await plusUntil(user)).toEqual(before);
  });

  it("accepts a payment on an order that an earlier attempt marked failed", async () => {
    const user = await createUser("retry");
    const o = await makeOrder(user);
    const failed = await actAs("service", () =>
      db.query<{ r: string }>(
        `select public.fail_order($1, $2, 'declined') as r`,
        [o, user],
      ),
    );
    expect(failed.rows[0].r).toBe("failed");
    expect((await order(o)).status).toBe("failed");
    expect((await grant(o, "pay_retry", { user })).result).toBe("granted");
    expect((await order(o)).status).toBe("paid");
  });

  it("rejects a bad source and empty ids", async () => {
    const user = await createUser("bad");
    const o = await makeOrder(user);
    await expect(grant(o, "pay_b", { source: "browser" })).rejects.toThrow(
      /bad_source/,
    );
    await expect(grant(o, "")).rejects.toThrow(/bad_ids/);
  });
});

describe("fail_order", () => {
  it("only fails an order that is still waiting, and only for its owner", async () => {
    const user = await createUser("failer");
    const other = await createUser("failer2");
    const o = await makeOrder(user);
    const call = (id: string, who: string | null) =>
      actAs("service", () =>
        db.query<{ r: string }>(`select public.fail_order($1, $2, 'x') as r`, [
          id,
          who,
        ]),
      );
    expect((await call(o, other)).rows[0].r).toBe("unchanged");
    await grant(o, "pay_fail_paid", { user });
    expect((await call(o, user)).rows[0].r).toBe("unchanged");
    expect((await order(o)).status).toBe("paid");
  });
});

describe("revoke_plus and grant_demo_plus", () => {
  it("lets an admin end Plus, marks the orders and writes the audit row", async () => {
    const admin = await createUser("admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [
      admin,
    ]);
    const user = await createUser("revokee");
    const o = await makeOrder(user);
    await grant(o, "pay_rev", { user });

    const out = await actAs("service", () =>
      db.query<{ r: { result: string } }>(
        `select public.revoke_plus($1, $2) as r`,
        [admin, user],
      ),
    );
    expect(out.rows[0].r.result).toBe("revoked");
    expect(ms(await plusUntil(user))).toBeLessThanOrEqual(Date.now());
    const audit = await db.query<{ action: string; target: string }>(
      `select action, target from public.audit_log where target = $1`,
      [`profile:${user}`],
    );
    expect(audit.rows).toEqual([
      { action: "plus_revoked", target: `profile:${user}` },
    ]);
    const revoked = await db.query<{ revoked_at: string | null }>(
      `select revoked_at from public.orders where razorpay_order_id = $1`,
      [o],
    );
    expect(revoked.rows[0].revoked_at).not.toBeNull();

    // Nothing left to revoke.
    await expect(
      actAs("service", () =>
        db.query(`select public.revoke_plus($1, $2)`, [admin, user]),
      ),
    ).rejects.toThrow(/not_plus/);
  });

  it("refuses a caller who is not an admin", async () => {
    const notAdmin = await createUser("notadmin");
    const user = await createUser("safe");
    await db.query(`update public.profiles set plus_until = $2 where id = $1`, [
      user,
      new Date(NOW.getTime() + DAY).toISOString(),
    ]);
    await expect(
      actAs("service", () =>
        db.query(`select public.revoke_plus($1, $2)`, [notAdmin, user]),
      ),
    ).rejects.toThrow(/not_admin/);
    expect(await plusUntil(user)).not.toBeNull();
  });

  it("grant_demo_plus adds days and logs an event", async () => {
    const user = await createUser("demo");
    await actAs("service", () =>
      db.query(`select public.grant_demo_plus($1, 30, $2::timestamptz)`, [
        user,
        NOW.toISOString(),
      ]),
    );
    expect(ms(await plusUntil(user))).toBe(NOW.getTime() + 30 * DAY);
    expect(
      await count(
        `select 1 from public.events where user_id = $1 and name = 'plus_demo_granted'`,
        [user],
      ),
    ).toBe(1);
  });
});

describe("row level security around payments", () => {
  it("a member can read only their own orders and cannot write any", async () => {
    const a = await createUser("rls-a");
    const b = await createUser("rls-b");
    const oa = await makeOrder(a);
    await makeOrder(b);

    const seen = await actAs(a, () =>
      db.query<{ razorpay_order_id: string }>(
        `select razorpay_order_id from public.orders`,
      ),
    );
    expect(seen.rows.map((r) => r.razorpay_order_id)).toEqual([oa]);

    await expect(
      actAs(a, () =>
        db.query(
          `insert into public.orders (user_id, razorpay_order_id, plan, amount_paise)
           values ($1, 'order_self', 'plus_1m', 100)`,
          [a],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(a, () =>
        db.query(
          `update public.orders set status = 'paid' where razorpay_order_id = $1`,
          [oa],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      actAs(a, () => db.query(`delete from public.orders`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("a member cannot give themselves Plus or reset the second look", async () => {
    const a = await createUser("rls-plus");
    for (const sql of [
      `update public.profiles set plus_until = now() + interval '1 year' where id = $1`,
      `update public.profiles set second_look_used_at = null where id = $1`,
    ]) {
      await expect(actAs(a, () => db.query(sql, [a]))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("an admin can read all orders", async () => {
    const admin = await createUser("rls-admin");
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [
      admin,
    ]);
    const seen = await actAs(admin, () =>
      db.query(`select id from public.orders`),
    );
    expect(seen.rows.length).toBeGreaterThan(3);
  });

  it("no browser role can call the money functions; only the server can", async () => {
    const a = await createUser("rls-call");
    const calls = [
      `select public.grant_plus('order_x', 'pay_x')`,
      `select public.fail_order('order_x', null, null)`,
      `select public.revoke_plus('${a}', '${a}')`,
      `select public.grant_demo_plus('${a}', 30)`,
      `select public.use_second_look('${a}', '${randomUUID()}')`,
      `select public.plus_extend('${a}', 30, now())`,
    ];
    for (const sql of calls) {
      for (const who of [a, "anon"]) {
        await expect(actAs(who, () => db.query(sql))).rejects.toThrow(
          /permission denied/,
        );
      }
    }
    // The helper is internal even for the server.
    await expect(
      actAs("service", () =>
        db.query(`select public.plus_extend('${a}', 30, now())`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

// ---------------------------------------------------------------------------
// Second look
// ---------------------------------------------------------------------------
describe("second look", () => {
  // A Monday two weeks ago: its intros are over (they expired a week ago) but
  // still inside the four week lookback.
  const monday = (weeksAgo: number) => {
    const d = new Date(NOW);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - weeksAgo * 7);
    return d.toISOString().slice(0, 10);
  };
  const drops = new Map<number, string>();
  async function dropOf(weeksAgo: number) {
    let id = drops.get(weeksAgo);
    if (!id) {
      const r = await db.query<{ id: string }>(
        `insert into public.drops (week_start) values ($1) returning id`,
        [monday(weeksAgo)],
      );
      id = r.rows[0].id;
      drops.set(weeksAgo, id);
    }
    return id;
  }

  async function plusMember(gender = "woman") {
    const id = await createUser(`sl-${gender}`);
    await db.query(
      `update public.profiles set gender = $2::public.gender, plus_until = $3 where id = $1`,
      [id, gender, new Date(NOW.getTime() + 30 * DAY).toISOString()],
    );
    return id;
  }
  async function intro(
    viewer: string,
    candidate: string,
    status: string,
    weeksAgo = 2,
  ) {
    const r = await db.query<{ id: string }>(
      `insert into public.intros (drop_id, viewer_id, candidate_id, status)
       values ($1, $2, $3, $4::public.intro_status) returning id`,
      [await dropOf(weeksAgo), viewer, candidate, status],
    );
    return r.rows[0].id;
  }
  const use = (user: string, introId: string, at = NOW) =>
    actAs("service", () =>
      db.query<{ r: { result: string; revived_until?: string } }>(
        `select public.use_second_look($1, $2, $3::timestamptz, $4, $5, $6, $7) as r`,
        [
          user,
          introId,
          at.toISOString(),
          SECOND_LOOK.perDays,
          SECOND_LOOK.lookbackDays,
          SECOND_LOOK.revivedHours,
          SHORTLIST_CONFIG.introExpiryMinutesAfterWeekStart,
        ],
      ),
    ).then((x) => x.rows[0].r);

  it("brings back a passed intro once, then makes the member wait", async () => {
    const me = await plusMember();
    const them = await plusMember("man");
    const passed = await intro(me, them, "passed");
    const other = await intro(me, await plusMember("man"), "passed");

    const out = await use(me, passed);
    expect(out.result).toBe("revived");
    expect(ms(out.revived_until!)).toBe(
      NOW.getTime() + SECOND_LOOK.revivedHours * 3600 * 1000,
    );
    const row = await db.query<{ status: string; revived_until: string }>(
      `select status, revived_until from public.intros where id = $1`,
      [passed],
    );
    expect(row.rows[0].status).toBe("new");

    // A second one inside 30 days is refused, and an already-back one too.
    expect((await use(me, other)).result).toBe("used_recently");
    expect((await use(me, passed)).result).toBe("used_recently");
    // After 30 days the member may use it again.
    expect(
      (await use(me, other, new Date(NOW.getTime() + 31 * DAY))).result,
    ).not.toBe("used_recently");
  });

  it("works for an intro that was never answered once its week is over", async () => {
    const me = await plusMember();
    const them = await plusMember("man");
    const unanswered = await intro(me, them, "new");
    expect((await use(me, unanswered)).result).toBe("revived");
  });

  it("refuses free members, other people's intros, old intros, decided ones and blocked people", async () => {
    const free = await createUser("sl-free");
    const them = await plusMember("man");
    const freeIntro = await intro(free, them, "passed");
    expect((await use(free, freeIntro)).result).toBe("not_plus");

    const me = await plusMember();
    const someone = await plusMember("man");
    const notMine = await intro(await plusMember(), someone, "passed");
    expect((await use(me, notMine)).result).toBe("not_found");

    const old = await intro(me, await plusMember("man"), "passed", 6);
    expect((await use(me, old)).result).toBe("too_old");

    const interested = await intro(me, await plusMember("man"), "interested");
    expect((await use(me, interested)).result).toBe("not_eligible");

    const blocked = await plusMember("man");
    const blockedIntro = await intro(me, blocked, "passed");
    await db.query(
      `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
      [blocked, me],
    );
    expect((await use(me, blockedIntro)).result).toBe("unavailable");
  });

  it("a brought-back intro can be answered after its week ended, and opens the chat when it is mutual", async () => {
    const me = await plusMember("woman");
    const them = await plusMember("man");
    const mine = await intro(me, them, "passed");
    await intro(them, me, "interested"); // they said yes in that drop
    expect((await use(me, mine)).result).toBe("revived");

    const answer = (at: Date) =>
      actAs("service", () =>
        db.query<{ r: { status: string } }>(
          `select public.decide_intro($1, $2, 'interested', null, $3::timestamptz) as r`,
          [me, mine, at.toISOString()],
        ),
      );
    const out = await answer(new Date(NOW.getTime() + 3600 * 1000));
    expect(out.rows[0].r.status).toBe("opened");
  });

  it("stops being answerable when the brought-back time is over", async () => {
    const me = await plusMember("woman");
    const them = await plusMember("man");
    const mine = await intro(me, them, "passed");
    await use(me, mine);
    await expect(
      actAs("service", () =>
        db.query(
          `select public.decide_intro($1, $2, 'interested', null, $3::timestamptz)`,
          [me, mine, new Date(NOW.getTime() + 4 * DAY).toISOString()],
        ),
      ),
    ).rejects.toThrow(/intro_expired/);
  });

  it("an ordinary old intro still cannot be answered (nothing else changed)", async () => {
    const me = await plusMember("woman");
    const them = await plusMember("man");
    const old = await intro(me, them, "new");
    await expect(
      actAs("service", () =>
        db.query(
          `select public.decide_intro($1, $2, 'interested', null, $3::timestamptz)`,
          [me, old, NOW.toISOString()],
        ),
      ),
    ).rejects.toThrow(/intro_expired/);
  });

  it("my_second_looks lists what could come back and what is back, for the caller only", async () => {
    const me = await plusMember("woman");
    const them = await plusMember("man");
    const third = await plusMember("man");
    const a = await intro(me, them, "passed");
    await intro(me, third, "passed");
    await intro(third, them, "passed"); // somebody else's: never listed

    const before = await actAs(me, () =>
      db.query<{
        r: {
          eligible: { id: string }[];
          revived: unknown[];
          used_at: string | null;
        };
      }>(`select public.my_second_looks() as r`),
    );
    expect(before.rows[0].r.eligible).toHaveLength(2);
    expect(before.rows[0].r.revived).toHaveLength(0);
    expect(before.rows[0].r.used_at).toBeNull();

    // Uses real "now" inside my_second_looks, so revive with the real clock.
    await use(me, a, new Date());
    const after = await actAs(me, () =>
      db.query<{ r: { eligible: unknown[]; revived: { id: string }[] } }>(
        `select public.my_second_looks() as r`,
      ),
    );
    expect(after.rows[0].r.revived.map((x) => x.id)).toEqual([a]);
    expect(after.rows[0].r.eligible).toHaveLength(1);
  });
});
