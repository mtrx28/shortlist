import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// What the admin area relies on in the database: who can read the audit log
// and the verification queue, who can change verification, and that nobody but
// the server can see a birth date or a pH ID hash.
// Not covered: the Next.js page and action code itself (needs a real session).

const root = process.cwd();
let db: PGlite;

const ids = { admin: randomUUID(), user: randomUUID(), pending: randomUUID() };

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

// Run `fn` as a signed-in user, or as the server ("service").
async function actAs<T>(
  who: string | "service",
  fn: () => Promise<T>,
): Promise<T> {
  const server = who === "service";
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    server ? "" : who,
  ]);
  await db.exec(`set role ${server ? "service_role" : "authenticated"}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

const rows = async (sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, unknown>>(sql, params)).rows;

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
  await db.query(
    `update public.profiles set elitmus_status = 'pending', elitmus_ref_hash = 'abc123' where id = $1`,
    [ids.pending],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("admin access to the verification queue", () => {
  it("lets an admin list pending profiles", async () => {
    const list = await actAs(ids.admin, () =>
      rows(`select id from public.profiles where elitmus_status = 'pending'`),
    );
    expect(list.map((r) => r.id)).toEqual([ids.pending]);
  });

  it("does not let a normal user list pending profiles", async () => {
    const list = await actAs(ids.user, () =>
      rows(`select id from public.profiles where elitmus_status = 'pending'`),
    );
    expect(list).toHaveLength(0);
  });

  it("gives an admin an age but never the birth date or the pH hash", async () => {
    const [age] = await actAs(ids.admin, () =>
      rows(`select public.profile_age($1) as age`, [ids.pending]),
    );
    expect(age.age).toBeGreaterThanOrEqual(18);
    for (const column of ["dob", "elitmus_ref_hash"]) {
      await expect(
        actAs(ids.admin, () =>
          rows(`select ${column} from public.profiles where id = $1`, [
            ids.pending,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("approving and rejecting", () => {
  const change = (who: string | "service", sql: string) =>
    actAs(who, () => db.query(sql, [ids.pending]));
  const approve = `update public.profiles set elitmus_status = 'verified' where id = $1`;

  it("is refused for a normal user", async () => {
    await expect(change(ids.user, approve)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("is refused for an admin using their own session: only the server may change it", async () => {
    await expect(change(ids.admin, approve)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      change(
        ids.admin,
        `update public.profiles set elitmus_ref_hash = null where id = $1`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("works through the service role, and a reject can clear the hash", async () => {
    await change(
      "service",
      `update public.profiles set elitmus_status = 'none', elitmus_ref_hash = null
        where id = $1 and elitmus_status = 'pending'`,
    );
    const [p] = await rows(
      `select elitmus_status, elitmus_ref_hash from public.profiles where id = $1`,
      [ids.pending],
    );
    expect(p).toEqual({ elitmus_status: "none", elitmus_ref_hash: null });
  });
});

describe("audit log", () => {
  it("is written only by the server", async () => {
    for (const who of [ids.user, ids.admin]) {
      await expect(
        actAs(who, () =>
          db.query(
            `insert into public.audit_log (admin_id, action, target) values ($1, 'verification_approved', 'x')`,
            [ids.admin],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
    await actAs("service", () =>
      db.query(
        `insert into public.audit_log (admin_id, action, target) values ($1, 'verification_approved', $2)`,
        [ids.admin, `profile:${ids.pending}`],
      ),
    );
  });

  it("is readable by admins and invisible to other users", async () => {
    expect(
      await actAs(ids.admin, () => rows(`select * from public.audit_log`)),
    ).toHaveLength(1);
    expect(
      await actAs(ids.user, () => rows(`select * from public.audit_log`)),
    ).toHaveLength(0);
  });

  it("cannot be edited or deleted by an admin", async () => {
    for (const sql of [
      `update public.audit_log set action = 'x'`,
      `delete from public.audit_log`,
    ]) {
      await expect(actAs(ids.admin, () => db.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});
