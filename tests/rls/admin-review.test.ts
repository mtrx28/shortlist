import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reviewResultFromError } from "@/lib/admin/review";

// admin_review_verification(): the one database call behind Approve / Reject.
// It must be atomic (status change + audit row together), re-check the admin
// and the pending state itself, and be callable by the server only.

const root = process.cwd();
let db: PGlite;

const ids = {
  admin: randomUUID(),
  user: randomUUID(),
  pendingA: randomUUID(),
  pendingB: randomUUID(),
  pendingC: randomUUID(),
  verified: randomUUID(),
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

const review = (
  caller: string | "service",
  admin: string,
  target: string,
  decision: string,
) =>
  actAs(caller, () =>
    db.query<{ r: string }>(
      `select public.admin_review_verification($1, $2, $3) as r`,
      [admin, target, decision],
    ),
  );

const profile = async (id: string) =>
  (
    await db.query<{ elitmus_status: string; elitmus_ref_hash: string | null }>(
      `select elitmus_status, elitmus_ref_hash from public.profiles where id = $1`,
      [id],
    )
  ).rows[0];

const auditCount = async () =>
  Number(
    (
      await db.query<{ n: string }>(
        `select count(*) as n from public.audit_log`,
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
  for (const [name, id] of Object.entries(ids)) await createUser(id, name);
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [
    ids.admin,
  ]);
  for (const id of [ids.pendingA, ids.pendingB, ids.pendingC]) {
    await db.query(
      `update public.profiles set elitmus_status = 'pending', elitmus_ref_hash = $2 where id = $1`,
      [id, `hash-${id}`],
    );
  }
  await db.query(
    `update public.profiles set elitmus_status = 'verified', elitmus_ref_hash = 'h-v' where id = $1`,
    [ids.verified],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_review_verification", () => {
  it("approves a pending request and writes the audit row", async () => {
    const out = await review("service", ids.admin, ids.pendingA, "approve");
    expect(out.rows[0].r).toBe("approved");
    expect((await profile(ids.pendingA)).elitmus_status).toBe("verified");
    const audit = await db.query<{
      admin_id: string;
      action: string;
      target: string;
    }>(`select admin_id, action, target from public.audit_log`);
    expect(audit.rows).toEqual([
      {
        admin_id: ids.admin,
        action: "verification_approved",
        target: `profile:${ids.pendingA}`,
      },
    ]);
  });

  it("rejects a pending request, clears the hash and audits it", async () => {
    const out = await review("service", ids.admin, ids.pendingB, "reject");
    expect(out.rows[0].r).toBe("rejected");
    expect(await profile(ids.pendingB)).toEqual({
      elitmus_status: "none",
      elitmus_ref_hash: null,
    });
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where target = $1`,
      [`profile:${ids.pendingB}`],
    );
    expect(audit.rows[0].action).toBe("verification_rejected");
  });

  it("refuses a caller who is not an admin, and changes nothing", async () => {
    const before = await auditCount();
    await expect(
      review("service", ids.user, ids.pendingC, "approve"),
    ).rejects.toThrow(/not_admin/);
    expect((await profile(ids.pendingC)).elitmus_status).toBe("pending");
    expect(await auditCount()).toBe(before);
  });

  it("refuses a suspended admin", async () => {
    await db.query(
      `update public.profiles set suspended_at = now() where id = $1`,
      [ids.admin],
    );
    await expect(
      review("service", ids.admin, ids.pendingC, "approve"),
    ).rejects.toThrow(/not_admin/);
    await db.query(
      `update public.profiles set suspended_at = null where id = $1`,
      [ids.admin],
    );
  });

  it("refuses a target that is not pending (already handled, or never requested)", async () => {
    const before = await auditCount();
    for (const target of [ids.pendingA, ids.pendingB, ids.verified, ids.user]) {
      await expect(
        review("service", ids.admin, target, "reject"),
      ).rejects.toThrow(/not_pending/);
    }
    // The verified person was not touched.
    expect(await profile(ids.verified)).toEqual({
      elitmus_status: "verified",
      elitmus_ref_hash: "h-v",
    });
    expect(await auditCount()).toBe(before);
  });

  it("refuses an unknown decision", async () => {
    await expect(
      review("service", ids.admin, ids.pendingC, "maybe"),
    ).rejects.toThrow(/bad_decision/);
  });

  it("is atomic: if the audit write fails, the status change is rolled back", async () => {
    await db.exec(`
      create function public.test_block_audit() returns trigger language plpgsql as
      $$ begin raise exception 'audit write blocked'; end; $$;
      create trigger test_block_audit before insert on public.audit_log
        for each row execute function public.test_block_audit();
    `);
    const before = await auditCount();
    await expect(
      review("service", ids.admin, ids.pendingC, "approve"),
    ).rejects.toThrow(/audit write blocked/);
    // Still pending, hash intact, no audit row: nothing half-done.
    expect(await profile(ids.pendingC)).toEqual({
      elitmus_status: "pending",
      elitmus_ref_hash: `hash-${ids.pendingC}`,
    });
    expect(await auditCount()).toBe(before);
    await db.exec(`drop trigger test_block_audit on public.audit_log`);
  });

  it("cannot be executed by a signed-in user, an admin session or a visitor", async () => {
    for (const caller of [ids.user, ids.admin]) {
      await expect(
        review(caller, ids.admin, ids.pendingC, "approve"),
      ).rejects.toThrow(/permission denied/);
    }
    await db.exec(`set role anon`);
    try {
      await expect(
        db.query(`select public.admin_review_verification($1, $2, 'approve')`, [
          ids.admin,
          ids.pendingC,
        ]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec(`reset role`);
    }
    expect((await profile(ids.pendingC)).elitmus_status).toBe("pending");
  });
});

describe("reviewResultFromError", () => {
  it("maps database errors to page messages", () => {
    expect(reviewResultFromError("not_pending")).toBe("already_handled");
    expect(reviewResultFromError("not_admin")).toBe("forbidden");
    expect(reviewResultFromError("boom")).toBe("failed");
    expect(reviewResultFromError(undefined)).toBe("failed");
  });
});
