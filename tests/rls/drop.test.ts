import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VALUES_QUESTIONS } from "@/config/values-questions";
import {
  runDrop,
  type DropStore,
  type ProfileRow,
} from "@/lib/matching/run-drop";

// Saving a drop: the write_drop() database function, and the whole run
// (load people, build, save) against a real Postgres (PGlite) through a small
// store written with plain SQL. The Supabase client version of the store
// (lib/matching/supabase-store.ts) is NOT exercised here; it only differs in
// how the same queries are sent.

const root = process.cwd();
let db: PGlite;

const NOW = new Date("2026-11-18T10:00:00Z"); // a Wednesday: week 2026-11-16
const WEEK = "2026-11-16";
const LAST_WEEK = "2026-11-09";

const ANSWERS = Object.fromEntries(
  VALUES_QUESTIONS.map((q) => [
    q.id,
    { answer: q.options[0].id, dealBreaker: false },
  ]),
);

const ids = {
  w1: randomUUID(),
  w2: randomUUID(),
  m1: randomUUID(),
  m2: randomUUID(),
  paused: randomUUID(),
};

async function createMember(
  id: string,
  name: string,
  gender: "woman" | "man",
  extra = "",
) {
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
  await db.query(
    `update public.profiles
        set gender = $2, interested_in = $3::public.gender[], city = 'Pune',
            intent = 'serious', batch_year = 2021, occupation = 'x',
            values_answers = $4::jsonb, interests = '{Coffee,Movies,Yoga}',
            onboarding_completed_at = now() ${extra}
      where id = $1`,
    [
      id,
      gender,
      gender === "woman" ? "{man}" : "{woman}",
      JSON.stringify(ANSWERS),
    ],
  );
}

// A store that reads and writes with SQL, acting as the server (service role).
class PgliteStore implements DropStore {
  async loadProfiles() {
    const r = await db.query<ProfileRow>(
      `select id, gender::text as gender, interested_in::text[] as interested_in,
              city, intent::text as intent, batch_year, dob::text as dob,
              values_answers, interests, paused, suspended_at::text as suspended_at,
              deleted_at::text as deleted_at,
              onboarding_completed_at::text as onboarding_completed_at,
              plus_until::text as plus_until, reply_rate_num, reply_rate_den
         from public.profiles order by id`,
    );
    return r.rows;
  }
  async loadHistory(fromWeek: string, weekStart: string) {
    const seen = await db.query<{ v: string; c: string; w: string }>(
      `select i.viewer_id as v, i.candidate_id as c, d.week_start::text as w
         from public.intros i join public.drops d on d.id = i.drop_id
        where d.week_start >= $1 and d.week_start < $2`,
      [fromWeek, weekStart],
    );
    const blocks = await db.query<{ a: string; b: string }>(
      `select blocker_id as a, blocked_id as b from public.blocks`,
    );
    const convos = await db.query<{ a: string; b: string }>(
      `select user_a as a, user_b as b from public.conversations
        where status in ('open','kept')`,
    );
    return {
      weekStart,
      seen: seen.rows.map((r) => ({
        viewerId: r.v,
        candidateId: r.c,
        weekStart: r.w,
      })),
      blocks: blocks.rows.map((r) => ({ blockerId: r.a, blockedId: r.b })),
      connected: convos.rows,
    };
  }
  async writeDrop(args: {
    weekStart: string;
    stats: Record<string, unknown>;
    intros: {
      viewerId: string;
      candidateId: string;
      score: number;
      reasons: string[];
    }[];
    rebuild: boolean;
  }) {
    const result = await asService(() =>
      db.query<{
        r: {
          status: "created" | "exists" | "blocked";
          drop_id?: string;
          intros?: number;
        };
      }>(
        `select public.write_drop($1::date, $2::jsonb, $3::jsonb, true, $4) as r`,
        [
          args.weekStart,
          JSON.stringify(args.stats),
          JSON.stringify(
            args.intros.map((i) => ({
              viewer_id: i.viewerId,
              candidate_id: i.candidateId,
              score: i.score,
              reasons: i.reasons,
            })),
          ),
          args.rebuild,
        ],
      ),
    );
    const r = result.rows[0].r;
    return { status: r.status, dropId: r.drop_id, intros: r.intros };
  }
}

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const count = async (table: string, where = "true") =>
  Number(
    (
      await db.query<{ n: string }>(
        `select count(*) as n from public.${table} where ${where}`,
      )
    ).rows[0].n,
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
  await createMember(ids.w1, "w1", "woman");
  await createMember(ids.w2, "w2", "woman");
  await createMember(ids.m1, "m1", "man");
  await createMember(
    ids.m2,
    "m2",
    "man",
    ", plus_until = now() + interval '30 days'",
  );
  await createMember(ids.paused, "paused", "man", ", paused = true");
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`delete from public.drops; delete from public.blocks;`);
});

describe("running a drop against the database", () => {
  it("creates the drop and its intros, with stats and reasons", async () => {
    const out = await runDrop(new PgliteStore(), { now: NOW, source: "admin" });
    expect(out.status).toBe("created");
    expect(out.weekStart).toBe(WEEK);
    // 2 women x 2 men, each shown to the other side: 8 intros.
    expect(await count("intros")).toBe(8);
    expect(out.stats?.usersEligible).toBe(4); // the paused member is left out
    const drop = await db.query<{
      stats: { source: string; skipped: { paused: number } };
    }>(`select stats from public.drops`);
    expect(drop.rows[0].stats.source).toBe("admin");
    expect(drop.rows[0].stats.skipped.paused).toBe(1);
    const reasons = await db.query<{ reasons: string[] }>(
      `select reasons from public.intros limit 1`,
    );
    expect(reasons.rows[0].reasons).toHaveLength(2);
  });

  it("can be run again for the same week without creating duplicates", async () => {
    const first = await runDrop(new PgliteStore(), { now: NOW });
    const second = await runDrop(new PgliteStore(), { now: NOW });
    const third = await runDrop(new PgliteStore(), {
      now: new Date("2026-11-20T08:00:00Z"), // later the same week
    });
    expect(second.status).toBe("exists");
    expect(third.status).toBe("exists");
    expect(second.dropId).toBe(first.dropId);
    expect(await count("drops")).toBe(1);
    expect(await count("intros")).toBe(8);
  });

  it("builds the same drop again for the same week (fixed seed)", async () => {
    await runDrop(new PgliteStore(), { now: NOW });
    const pairs = async () =>
      (
        await db.query(
          `select viewer_id, candidate_id, score, reasons from public.intros order by viewer_id, candidate_id`,
        )
      ).rows;
    const before = await pairs();
    await runDrop(new PgliteStore(), { now: NOW, rebuild: true });
    expect(await pairs()).toEqual(before);
  });

  it("replaces a demo drop for the week but leaves other weeks and their intros alone", async () => {
    const demoThisWeek = randomUUID();
    const demoLastWeek = randomUUID();
    await db.query(
      `insert into public.drops (id, week_start, stats) values ($1, $2, '{"demo": true}'), ($3, $4, '{"demo": true}')`,
      [demoThisWeek, WEEK, demoLastWeek, LAST_WEEK],
    );
    await db.query(
      `insert into public.intros (drop_id, viewer_id, candidate_id, status)
       values ($1, $2, $3, 'interested'), ($4, $2, $3, 'new')`,
      [demoLastWeek, ids.w1, ids.m1, demoThisWeek],
    );

    const out = await runDrop(new PgliteStore(), { now: NOW });
    expect(out.status).toBe("created");
    expect(await count("drops", `id = '${demoThisWeek}'`)).toBe(0); // replaced
    expect(await count("drops", `id = '${demoLastWeek}'`)).toBe(1); // untouched
    expect(await count("intros", `drop_id = '${demoLastWeek}'`)).toBe(1);
    // Last week's demo intro (w1 saw m1) counts as history: no repeat.
    expect(
      await count(
        "intros",
        `drop_id = '${out.dropId}' and viewer_id = '${ids.w1}' and candidate_id = '${ids.m1}'`,
      ),
    ).toBe(0);
  });

  it("does not rebuild a real drop once someone has answered", async () => {
    const first = await runDrop(new PgliteStore(), { now: NOW });
    await db.query(
      `update public.intros set status = 'interested' where id = (select id from public.intros limit 1)`,
    );
    const again = await runDrop(new PgliteStore(), { now: NOW, rebuild: true });
    expect(again.status).toBe("blocked");
    expect(await count("drops", `id = '${first.dropId}'`)).toBe(1);
    expect(await count("intros", "status = 'interested'")).toBe(1);
  });

  it("respects blocks and live conversations when it loads history", async () => {
    await db.query(
      `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
      [ids.w1, ids.m1],
    );
    await runDrop(new PgliteStore(), { now: NOW });
    expect(
      await count(
        "intros",
        `(viewer_id = '${ids.w1}' and candidate_id = '${ids.m1}') or (viewer_id = '${ids.m1}' and candidate_id = '${ids.w1}')`,
      ),
    ).toBe(0);
    expect(await count("intros", `viewer_id = '${ids.w1}'`)).toBe(1); // only m2
  });

  it("reads Plus status from the profile but never pads a small pool", async () => {
    // m2 is Plus (5 intros) but only 2 women exist, so he gets 2, not 5.
    await runDrop(new PgliteStore(), { now: NOW });
    expect(await count("intros", `viewer_id = '${ids.m2}'`)).toBe(2);
  });
});

describe("write_drop() on its own", () => {
  const call = (
    week: string,
    intros: unknown[],
    replaceDemo = true,
    rebuild = false,
  ) =>
    asService(() =>
      db.query<{ r: { status: string } }>(
        `select public.write_drop($1::date, '{}'::jsonb, $2::jsonb, $3, $4) as r`,
        [week, JSON.stringify(intros), replaceDemo, rebuild],
      ),
    );

  it("is all or nothing: a bad intro leaves no drop behind", async () => {
    await expect(
      call(WEEK, [
        { viewer_id: ids.w1, candidate_id: ids.m1, score: 0.5, reasons: [] },
        // A person shown to themselves breaks the table's own rule.
        { viewer_id: ids.w2, candidate_id: ids.w2, score: 0.5, reasons: [] },
      ]),
    ).rejects.toThrow();
    expect(await count("drops")).toBe(0);
    expect(await count("intros")).toBe(0);
  });

  it("can be told to leave a demo drop alone", async () => {
    await db.query(
      `insert into public.drops (week_start, stats) values ($1, '{"demo": true}')`,
      [WEEK],
    );
    const out = await call(WEEK, [], false, false);
    expect(out.rows[0].r.status).toBe("exists");
  });

  it("rejects input that is not a JSON array", async () => {
    await expect(call(WEEK, {} as never)).rejects.toThrow(/array/);
  });

  it("cannot be executed by visitors, signed-in users or admins' own sessions", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(
          db.query(
            `select public.write_drop($1::date, '{}'::jsonb, '[]'::jsonb)`,
            [WEEK],
          ),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
    expect(await count("drops")).toBe(0);
  });
});
