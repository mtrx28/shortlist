import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMetricCards, parseRawMetrics } from "@/lib/admin/metrics";

// admin_metrics(): the totals behind the admin dashboard cards. Admins only,
// totals only, and the numbers add up against rows we put in ourselves.

const root = process.cwd();
let db: PGlite;
const ids = {
  admin: randomUUID(),
  a: randomUUID(),
  b: randomUUID(),
  c: randomUUID(),
};

async function createUser(id: string, name: string) {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [
      id,
      `${name}@example.com`,
      JSON.stringify({
        display_name: name,
        dob: "1998-03-14",
        accepted_terms: "true",
        accepted_privacy: "true",
        consent_version: "test-1",
      }),
    ],
  );
}

async function actAs<T>(who: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    who,
  ]);
  await db.exec(`set role authenticated`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

const metrics = (who: string) =>
  actAs(who, () =>
    db.query<{ m: Record<string, number> }>(
      `select public.admin_metrics() as m`,
    ),
  );

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
  // a: finished, verified, Plus. b: finished. c: not finished.
  await db.query(
    `update public.profiles set onboarding_completed_at = now(),
       elitmus_status = 'verified', elitmus_ref_hash = 'h',
       plus_until = now() + interval '10 days',
       reply_rate_num = 3, reply_rate_den = 4 where id = $1`,
    [ids.a],
  );
  await db.query(
    `update public.profiles set onboarding_completed_at = now(),
       reply_rate_num = 1, reply_rate_den = 2 where id = $1`,
    [ids.b],
  );
  await db.query(
    `insert into public.orders (user_id, razorpay_order_id, razorpay_payment_id, plan, amount_paise, status)
     values ($1, 'o1', 'pay_1', 'plus_1m', 19900, 'paid'),
            ($1, 'o2', null, 'plus_3m', 49900, 'created'),
            ($1, 'o3', null, 'plus_1m', 19900, 'failed')`,
    [ids.a],
  );
  const conv = (status: string, a: string, b: string) =>
    db.query(
      `insert into public.conversations (user_a, user_b, opener_id, status, window_ends_at)
       values ($1, $2, $1, $3, now() + interval '3 days')`,
      [a, b, status],
    );
  await conv("kept", ids.a, ids.b);
  await conv("closed", ids.a, ids.c);
  await conv("open", ids.b, ids.c);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_metrics", () => {
  it("returns the totals to an admin", async () => {
    const m = (await metrics(ids.admin)).rows[0].m;
    expect(m).toMatchObject({
      members: 2,
      verified: 1,
      active_chats: 2,
      kept_chats: 1,
      closed_chats: 1,
      expired_chats: 0,
      plus_members: 1,
      paid_orders: 1,
      revenue_paise: 19900,
      replies_owed: 6,
      replies_sent: 4,
    });
  });

  it("feeds the cards without trouble", async () => {
    const raw = parseRawMetrics((await metrics(ids.admin)).rows[0].m)!;
    const cards = buildMetricCards(raw);
    expect(cards.find((c) => c.id === "reply-rate")!.value).toBe("67%");
    expect(cards.find((c) => c.id === "revenue")!.value).toBe("Rs 199");
  });

  it("refuses an ordinary member", async () => {
    await expect(metrics(ids.a)).rejects.toThrow(/not_admin/);
  });

  it("refuses a suspended admin", async () => {
    await db.query(
      `update public.profiles set suspended_at = now() where id = $1`,
      [ids.admin],
    );
    await expect(metrics(ids.admin)).rejects.toThrow(/not_admin/);
    await db.query(
      `update public.profiles set suspended_at = null where id = $1`,
      [ids.admin],
    );
  });

  it("is not callable by signed-out visitors", async () => {
    await db.exec(`set role anon`);
    try {
      await expect(db.query(`select public.admin_metrics()`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  });
});
