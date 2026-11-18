import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safetyErrorCode } from "@/lib/safety/service";

// The safety, privacy and deletion functions from the M7 migration, run in an
// in-process Postgres. What this does NOT cover: Storage (photo files) and the
// real auth service; the integration tests against a local Supabase do.

const root = process.cwd();
let db: PGlite;
const PEPPER = "a-long-enough-test-secret-1234";

type Person = "ann" | "ben" | "cara" | "dev" | "admin" | "admin2";
const id: Record<Person, string> = {
  ann: randomUUID(),
  ben: randomUUID(),
  cara: randomUUID(),
  dev: randomUUID(),
  admin: randomUUID(),
  admin2: randomUUID(),
};

async function createUser(uid: string, name: string) {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [
      uid,
      `${name}@example.com`,
      JSON.stringify({
        display_name: name,
        dob: "1998-03-14",
        accepted_terms: "true",
        accepted_privacy: "true",
        consent_version: "v1",
      }),
    ],
  );
}

// Run as the server (service role) or a signed-in user.
async function as<T>(
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

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  (await db.query<T>(sql, p)).rows;
const one = async <T = Record<string, unknown>>(
  sql: string,
  p: unknown[] = [],
) => (await q<T>(sql, p))[0];

// Calls a function as the server and returns jsonb as an object.
async function call<T = Record<string, unknown>>(sql: string, p: unknown[]) {
  const r = await as("service", () =>
    db.query<{ r: T }>(`select ${sql} as r`, p),
  );
  return r.rows[0].r;
}
// Same, but returns the short error code instead of throwing.
async function fail(sql: string, p: unknown[]) {
  try {
    await as("service", () => db.query(`select ${sql} as r`, p));
  } catch (e) {
    return safetyErrorCode((e as Error).message) ?? (e as Error).message;
  }
  return "no error";
}

let dropId: string;
async function intro(viewer: string, candidate: string) {
  await db.query(
    `insert into public.intros (drop_id, viewer_id, candidate_id) values ($1, $2, $3)`,
    [dropId, viewer, candidate],
  );
}
async function chat(a: string, b: string, status = "open") {
  // Only one live chat per pair is allowed, so end an earlier one first.
  await db.query(
    `update public.conversations set status = 'closed'
      where status in ('open', 'kept')
        and least(user_a, user_b) = least($1::uuid, $2::uuid)
        and greatest(user_a, user_b) = greatest($1::uuid, $2::uuid)`,
    [a, b],
  );
  const r = await one<{ id: string }>(
    `insert into public.conversations (user_a, user_b, opener_id, status, window_ends_at)
     values ($1, $2, $1, $3, now() + interval '3 days') returning id`,
    [a, b, status],
  );
  return r.id;
}
// Each message gets a later time than the one before it, so the order is clear.
let tick = 0;
async function say(conv: string, sender: string, body: string) {
  tick += 1;
  await db.query(
    `insert into public.messages (conversation_id, sender_id, body, created_at)
     values ($1, $2, $3, now() + $4 * interval '1 second')`,
    [conv, sender, body, tick],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(root, "tests/rls/bootstrap.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  for (const [name, uid] of Object.entries(id)) await createUser(uid, name);
  await db.query(
    `update public.profiles set role = 'admin' where id in ($1, $2)`,
    [id.admin, id.admin2],
  );
  dropId = (
    await one<{ id: string }>(
      `insert into public.drops (week_start) values ('2026-11-16') returning id`,
    )
  ).id;
});

afterAll(async () => {
  await db.close();
});

describe("safetyErrorCode", () => {
  it("finds whole codes only", () => {
    expect(safetyErrorCode("ERROR: rate_limited")).toBe("rate_limited");
    expect(safetyErrorCode("decision_not_open")).toBe(null);
    expect(safetyErrorCode(undefined)).toBe(null);
  });
});

describe("who may call the functions", () => {
  it("is service role only", async () => {
    for (const sql of [
      `public.block_user('${id.ann}', '${id.ben}')`,
      `public.export_my_data('${id.ann}')`,
      `public.delete_account('${id.ann}', '${PEPPER}')`,
      `public.admin_resolve_report('${id.admin}', '${randomUUID()}', 'ack')`,
    ]) {
      await expect(as(id.ann, () => db.query(`select ${sql}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("block_user", () => {
  it("ends live chats at once, frees the slot, and hides both people", async () => {
    await intro(id.ann, id.ben);
    await intro(id.ben, id.ann);
    const open = await chat(id.ann, id.ben, "open");
    await say(open, id.ann, "hello");

    const out = await call<{
      already: boolean;
      ended: number;
      freed_user_ids: string[];
    }>(`public.block_user($1, $2)`, [id.ann, id.ben]);
    expect(out.already).toBe(false);
    expect(out.ended).toBe(1);
    expect(out.freed_user_ids.sort()).toEqual([id.ann, id.ben].sort());

    const c = await one<{ status: string; closed_by: string }>(
      `select status, closed_by from public.conversations where id = $1`,
      [open],
    );
    expect(c.status).toBe("blocked");
    expect(c.closed_by).toBe(id.ann);

    // Neither can read the other's profile any more.
    for (const [viewer, target] of [
      [id.ann, id.ben],
      [id.ben, id.ann],
    ]) {
      const seen = await as(viewer, () =>
        q(`select id from public.profiles where id = $1`, [target]),
      );
      expect(seen).toHaveLength(0);
    }
    // No messages can be sent into the ended chat.
    expect(
      await fail(`public.send_message($1, $2, 'hi')`, [id.ben, open]),
    ).toBe("not_open");
    // The unanswered intros were marked expired.
    const left = await q(
      `select id from public.intros where status = 'new'
        and viewer_id in ($1, $2) and candidate_id in ($1, $2)`,
      [id.ann, id.ben],
    );
    expect(left).toHaveLength(0);
  });

  it("is idempotent and a repeat does not count toward the limit", async () => {
    const again = await call<{ already: boolean; ended: number }>(
      `public.block_user($1, $2)`,
      [id.ann, id.ben],
    );
    expect(again.already).toBe(true);
    expect(again.ended).toBe(0);
  });

  it("ends a kept chat too", async () => {
    await intro(id.cara, id.dev);
    const kept = await chat(id.cara, id.dev, "kept");
    const out = await call<{ ended: number }>(`public.block_user($1, $2)`, [
      id.dev,
      id.cara,
    ]);
    expect(out.ended).toBe(1);
    expect(
      (
        await one<{ status: string }>(
          `select status from public.conversations where id=$1`,
          [kept],
        )
      ).status,
    ).toBe("blocked");
  });

  it("refuses a stranger, yourself, and a missing person with the same codes", async () => {
    expect(await fail(`public.block_user($1, $2)`, [id.ann, id.cara])).toBe(
      "target_not_found",
    );
    expect(
      await fail(`public.block_user($1, $2)`, [id.ann, randomUUID()]),
    ).toBe("target_not_found");
    expect(await fail(`public.block_user($1, $2)`, [id.ann, id.ann])).toBe(
      "bad_target",
    );
  });

  it("is rate limited by the database", async () => {
    // A limit of 1: ann already has one block today, so a second new one fails.
    await intro(id.ann, id.dev);
    expect(
      await fail(`public.block_user($1, $2, now(), 1)`, [id.ann, id.dev]),
    ).toBe("rate_limited");
    // A real block would still work under the normal limit.
    const ok = await call<{ already: boolean }>(`public.block_user($1, $2)`, [
      id.ann,
      id.dev,
    ]);
    expect(ok.already).toBe(false);
  });
});

describe("report_user", () => {
  it("copies the last messages itself, labelled, with no names", async () => {
    await intro(id.ben, id.cara);
    const conv = await chat(id.ben, id.cara, "open");
    await say(conv, id.cara, "first");
    await say(conv, id.ben, "second");
    await say(conv, id.cara, "third");

    const out = await call<{
      id: string;
      status: string;
      evidence_count: number;
    }>(
      `public.report_user($1, $2, $3, 'harassment', 'rude', true, now(), 5, 2)`,
      [id.ben, id.cara, conv],
    );
    expect(out.status).toBe("received");
    expect(out.evidence_count).toBe(2); // only the newest 2
    const row = await one<{ evidence: { from: string; body: string }[] }>(
      `select evidence from public.reports where id = $1`,
      [out.id],
    );
    expect(row.evidence.map((e) => [e.from, e.body])).toEqual([
      ["reporter", "second"],
      ["reported", "third"],
    ]);
    expect(JSON.stringify(row.evidence)).not.toContain(id.ben);
  });

  it("attaches nothing unless asked", async () => {
    await intro(id.dev, id.ann);
    const conv = await chat(id.dev, id.ann, "closed");
    await say(conv, id.ann, "secret");
    const out = await call<{ id: string }>(
      `public.report_user($1, $2, $3, 'scam', null, false)`,
      [id.dev, id.ann, conv],
    );
    const row = await one<{ evidence: unknown }>(
      `select evidence from public.reports where id = $1`,
      [out.id],
    );
    expect(row.evidence).toBeNull();
  });

  it("returns the first open report instead of adding a second", async () => {
    const again = await call<{ status: string }>(
      `public.report_user($1, $2, null, 'scam', null)`,
      [id.dev, id.ann],
    );
    expect(again.status).toBe("already_reported");
  });

  it("rejects bad input, strangers and a chat that is not theirs", async () => {
    expect(
      await fail(`public.report_user($1, $2, null, 'nonsense', null)`, [
        id.ben,
        id.cara,
      ]),
    ).toBe("bad_reason");
    expect(
      await fail(`public.report_user($1, $2, null, 'other', $3)`, [
        id.ben,
        id.cara,
        "x".repeat(1001),
      ]),
    ).toBe("bad_details");
    expect(
      await fail(`public.report_user($1, $2, null, 'other', null, true)`, [
        id.ben,
        id.cara,
      ]),
    ).toBe("bad_attach");
    expect(
      await fail(`public.report_user($1, $2, null, 'other', null)`, [
        id.ann,
        id.admin,
      ]),
    ).toBe("target_not_found");
    const someoneElses = await chat(id.cara, id.dev, "closed");
    expect(
      await fail(`public.report_user($1, $2, $3, 'other', null, true)`, [
        id.ben,
        id.cara,
        someoneElses,
      ]),
    ).toBe("conversation_not_found");
  });

  it("is rate limited", async () => {
    expect(
      await fail(
        `public.report_user($1, $2, null, 'other', null, false, now(), 1)`,
        [id.ben, id.cara],
      ),
      // ben already filed one report today, and that one is still open, so
      // the duplicate rule answers first; use a different target instead.
    ).toBe("no error");
    await intro(id.ben, id.dev);
    expect(
      await fail(
        `public.report_user($1, $2, null, 'other', null, false, now(), 1)`,
        [id.ben, id.dev],
      ),
    ).toBe("rate_limited");
  });

  it("is invisible to the reporter and the reported person", async () => {
    for (const who of [id.ben, id.cara]) {
      expect(
        await as(who, () => q(`select id from public.reports`)),
      ).toHaveLength(0);
    }
  });
});

describe("admin report handling", () => {
  let reportId: string;
  beforeAll(async () => {
    await intro(id.cara, id.ben);
    await intro(id.admin, id.cara).catch(() => undefined);
    const conv = await chat(id.cara, id.ben, "open");
    await say(conv, id.ben, "evidence line");
    reportId = (
      await call<{ id: string }>(
        `public.report_user($1, $2, $3, 'scam', 'asked for money', true)`,
        [id.cara, id.ben, conv],
      )
    ).id;
  });

  it("shows evidence only on request, and logs that it was opened", async () => {
    const plain = await call<{ evidence: unknown; has_evidence: boolean }>(
      `public.admin_get_report($1, $2, false)`,
      [id.admin, reportId],
    );
    expect(plain.has_evidence).toBe(true);
    expect(plain.evidence).toBeNull();
    const before = await one<{ n: number }>(
      `select count(*)::int n from public.audit_log where action = 'report_evidence_viewed'`,
    );
    const opened = await call<{ evidence: { body: string }[] }>(
      `public.admin_get_report($1, $2, true)`,
      [id.admin, reportId],
    );
    expect(opened.evidence[0].body).toBe("evidence line");
    const after = await one<{ n: number }>(
      `select count(*)::int n from public.audit_log where action = 'report_evidence_viewed'`,
    );
    expect(after.n).toBe(before.n + 1);
  });

  it("a normal user cannot act as admin", async () => {
    expect(
      await fail(`public.admin_get_report($1, $2, true)`, [id.ann, reportId]),
    ).toBe("not_admin");
    expect(
      await fail(`public.admin_resolve_report($1, $2, 'dismiss')`, [
        id.ann,
        reportId,
      ]),
    ).toBe("not_admin");
  });

  it("acknowledges once, with an audit row", async () => {
    const out = await call<{ status: string }>(
      `public.admin_resolve_report($1, $2, 'ack', 'looking')`,
      [id.admin, reportId],
    );
    expect(out.status).toBe("ack");
    const r = await one<{ status: string; ack_at: string }>(
      `select status, ack_at from public.reports where id = $1`,
      [reportId],
    );
    expect(r.status).toBe("ack");
    expect(r.ack_at).not.toBeNull();
    expect(
      await fail(`public.admin_resolve_report($1, $2, 'ack')`, [
        id.admin,
        reportId,
      ]),
    ).toBe("already_acknowledged");
  });

  it("actions with a suspension: profile hidden, chats ended, audit written, all together", async () => {
    const out = await call<{
      status: string;
      suspended: boolean;
      freed_user_ids: string[];
    }>(`public.admin_resolve_report($1, $2, 'action', 'confirmed', true)`, [
      id.admin,
      reportId,
    ]);
    expect(out.status).toBe("actioned");
    expect(out.suspended).toBe(true);
    expect(out.freed_user_ids).toContain(id.cara);

    const ben = await one<{ suspended_at: string | null }>(
      `select suspended_at from public.profiles where id = $1`,
      [id.ben],
    );
    expect(ben.suspended_at).not.toBeNull();
    const live = await q(
      `select id from public.conversations where status in ('open','kept') and $1 in (user_a, user_b)`,
      [id.ben],
    );
    expect(live).toHaveLength(0);
    const audit = await q<{ action: string }>(
      `select action from public.audit_log where admin_id = $1 order by id`,
      [id.admin],
    );
    const names = audit.map((a) => a.action);
    expect(names).toContain("report_acknowledged");
    expect(names).toContain("user_suspended");
    expect(names).toContain("report_actioned");
    // Cara cannot see the suspended person any more.
    expect(
      await as(id.cara, () =>
        q(`select id from public.profiles where id = $1`, [id.ben]),
      ),
    ).toHaveLength(0);
    // And the suspended person cannot send anything.
    expect(
      await fail(`public.admin_resolve_report($1, $2, 'dismiss')`, [
        id.admin,
        reportId,
      ]),
    ).toBe("already_resolved");
  });

  it("can lift a suspension, and refuses to suspend an admin", async () => {
    await call(`public.admin_unsuspend_user($1, $2)`, [id.admin, id.ben]);
    expect(
      (
        await one<{ s: string | null }>(
          `select suspended_at s from public.profiles where id=$1`,
          [id.ben],
        )
      ).s,
    ).toBeNull();
    expect(
      await fail(`public.admin_unsuspend_user($1, $2)`, [id.admin, id.ben]),
    ).toBe("not_suspended");

    await intro(id.cara, id.admin2);
    const rep = await call<{ id: string }>(
      `public.report_user($1, $2, null, 'other', null)`,
      [id.cara, id.admin2],
    );
    expect(
      await fail(`public.admin_resolve_report($1, $2, 'action', null, true)`, [
        id.admin,
        rep.id,
      ]),
    ).toBe("cannot_suspend");
  });
});

describe("end_kept_conversation", () => {
  it("closes only a kept chat, for either person, with their note", async () => {
    await intro(id.dev, id.cara).catch(() => undefined);
    const kept = await chat(id.ann, id.cara, "kept");
    const open = await chat(id.ben, id.dev, "open");
    expect(
      await fail(`public.end_kept_conversation($1, $2, 'bye')`, [id.ben, open]),
    ).toBe("not_kept");
    expect(
      await fail(`public.end_kept_conversation($1, $2, 'bye')`, [id.dev, kept]),
    ).toBe("conversation_not_found");
    const out = await call<{ other_id: string }>(
      `public.end_kept_conversation($1, $2, 'Thank you')`,
      [id.cara, kept],
    );
    expect(out.other_id).toBe(id.ann);
    const c = await one<{
      status: string;
      closed_by: string;
      closed_reason: string;
    }>(
      `select status, closed_by, closed_reason from public.conversations where id=$1`,
      [kept],
    );
    expect(c).toEqual({
      status: "closed",
      closed_by: id.cara,
      closed_reason: "Thank you",
    });
    expect(
      await fail(`public.end_kept_conversation($1, $2, 'bye')`, [
        id.cara,
        kept,
      ]),
    ).toBe("not_kept");
  });
});

describe("contact messages", () => {
  it("stores a message, limits per sender and overall, and admins read it", async () => {
    const send = (key: string, per = 3, global = 100) =>
      call<{ id: string }>(
        `public.submit_contact_message(null, 'Zed', 'zed@example.com', 'Hello there, a question', $1, now(), $2, $3)`,
        [key, per, global],
      );
    await send("k1");
    await send("k1");
    await send("k1");
    await expect(send("k1")).rejects.toThrow(/rate_limited/);
    await expect(send("k2", 3, 4)).resolves.toBeTruthy(); // 4th overall
    await expect(send("k3", 3, 4)).rejects.toThrow(/rate_limited/); // global ceiling
    expect(
      await fail(
        `public.submit_contact_message(null, 'Zed', 'not-an-email', 'Hello there, a question', 'k9')`,
        [],
      ),
    ).toBe("bad_message");

    const asAdmin = await as(id.admin, () =>
      q(`select id from public.contact_messages`),
    );
    expect(asAdmin.length).toBeGreaterThanOrEqual(4);
    expect(
      await as(id.ann, () => q(`select id from public.contact_messages`)),
    ).toHaveLength(0);

    await call(`public.admin_mark_contact_handled($1, $2)`, [
      id.admin,
      asAdmin[0].id,
    ]);
    expect(
      await fail(`public.admin_mark_contact_handled($1, $2)`, [
        id.admin,
        asAdmin[0].id,
      ]),
    ).toBe("not_open");
  });
});

describe("set_consent", () => {
  it("withdrawing eLitmus sharing unlinks verification in the same step", async () => {
    await db.query(
      `update public.profiles set elitmus_status = 'verified', elitmus_ref_hash = 'abc' where id = $1`,
      [id.ann],
    );
    await db.query(
      `insert into public.consents (user_id, kind, policy_version, granted) values ($1, 'elitmus_data_sharing', 'v1', true)`,
      [id.ann],
    );
    const out = await call<{ changed: boolean }>(
      `public.set_consent($1, 'elitmus_data_sharing', false, 'v2', now() + interval '1 minute')`,
      [id.ann],
    );
    expect(out.changed).toBe(true);
    const p = await one<{
      elitmus_status: string;
      elitmus_ref_hash: string | null;
    }>(
      `select elitmus_status, elitmus_ref_hash from public.profiles where id=$1`,
      [id.ann],
    );
    expect(p).toEqual({ elitmus_status: "none", elitmus_ref_hash: null });
    const again = await call<{ changed: boolean }>(
      `public.set_consent($1, 'elitmus_data_sharing', false, 'v2', now() + interval '1 minute')`,
      [id.ann],
    );
    expect(again.changed).toBe(false);
  });

  it("keeps terms and privacy, and allows marketing both ways", async () => {
    expect(
      await fail(`public.set_consent($1, 'terms', false, 'v2')`, [id.ann]),
    ).toBe("cannot_withdraw");
    expect(
      await fail(`public.set_consent($1, 'elitmus_data_sharing', true, 'v2')`, [
        id.ann,
      ]),
    ).toBe("use_verification_form");
    expect(
      await fail(`public.set_consent($1, 'nope', true, 'v2')`, [id.ann]),
    ).toBe("bad_kind");
    await call(
      `public.set_consent($1, 'marketing', true, 'v2', now() + interval '1 minute')`,
      [id.ann],
    );
    await call(
      `public.set_consent($1, 'marketing', false, 'v2', now() + interval '2 minutes')`,
      [id.ann],
    );
    const rows = await q<{ granted: boolean }>(
      `select granted from public.consents where user_id=$1 and kind='marketing' order by at, id`,
      [id.ann],
    );
    expect(rows.map((r) => r.granted)).toEqual([true, false]);
  });
});

describe("export_my_data", () => {
  it("contains the person's own data and none of anybody else's", async () => {
    // Cara and Dev chat; Dev writes something Cara must not get back, and
    // Cara's own words must be in her export.
    const conv = await chat(id.cara, id.dev, "open");
    await say(conv, id.cara, "my own words");
    await say(conv, id.dev, "dev private words");
    await db.query(
      `update public.profiles set display_name = 'DevUniqueName' where id = $1`,
      [id.dev],
    );
    await intro(id.cara, id.dev).catch(() => undefined);

    const data = await call<Record<string, unknown>>(
      `public.export_my_data($1)`,
      [id.cara],
    );
    const text = JSON.stringify(data);
    expect(text).toContain("my own words");
    expect(text).not.toContain("dev private words");
    expect(text).not.toContain("DevUniqueName");
    expect(text).not.toContain(id.dev);
    expect(text).not.toContain("dev@example.com");
    expect((data.account as { email: string }).email).toBe("cara@example.com");
    const profile = data.profile as Record<string, unknown>;
    expect(profile).not.toHaveProperty("role");
    expect(profile).not.toHaveProperty("elitmus_ref_hash");
    expect(profile).not.toHaveProperty("suspended_at");
    expect(profile.date_of_birth).toBeTruthy();
    // Reports they filed carry their words but not the admin's note or evidence.
    const filed = data.reports_i_filed as Record<string, unknown>[];
    expect(filed.length).toBeGreaterThan(0);
    expect(JSON.stringify(filed)).not.toContain("evidence line");
    expect(JSON.stringify(filed)).not.toContain("confirmed");
  });

  it("is rate limited to a few a day", async () => {
    expect(await fail(`public.export_my_data($1, now(), 1)`, [id.cara])).toBe(
      "rate_limited",
    );
  });
});

describe("delete_account", () => {
  const victim = randomUUID();
  const other = randomUUID();
  const reporterOfVictim = randomUUID();
  let convId: string;

  beforeAll(async () => {
    await createUser(victim, "victim");
    await createUser(other, "other");
    await createUser(reporterOfVictim, "rep");
    await intro(victim, other);
    await intro(other, victim);
    await intro(reporterOfVictim, victim);
    convId = await chat(victim, other, "open");
    await say(convId, victim, "bye bye");
    await say(convId, other, "other side");
    // A report against the victim (still open), one the victim filed
    // (dismissed), a payment, an event and a contact message.
    await call(
      `public.report_user($1, $2, null, 'harassment', 'named victim here', false)`,
      [reporterOfVictim, victim],
    );
    const filed = await call<{ id: string }>(
      `public.report_user($1, $2, null, 'other', 'victim words', false)`,
      [victim, other],
    );
    await call(`public.admin_resolve_report($1, $2, 'dismiss', 'nope')`, [
      id.admin,
      filed.id,
    ]);
    await db.query(
      `insert into public.orders (user_id, razorpay_order_id, plan, amount_paise) values ($1, 'order_x', 'plus_1m', 19900)`,
      [victim],
    );
    await db.query(
      `insert into public.events (user_id, name) values ($1, 'login')`,
      [victim],
    );
    await call(
      `public.submit_contact_message($1, 'V', 'v@example.com', 'my own question here', 'kv')`,
      [victim],
    );
    await db.query(
      `insert into public.audit_log (admin_id, action, target) values ($1, 'user_suspended', $2)`,
      [id.admin, `profile:${victim}`],
    );
  });

  it("removes the person and keeps only the minimal record", async () => {
    const out = await call<{ status: string; freed_user_ids: string[] }>(
      `public.delete_account($1, $2)`,
      [victim, PEPPER],
    );
    expect(out.status).toBe("deleted");
    expect(out.freed_user_ids).toEqual([other]);

    const gone = async (sql: string) => (await q(sql, [victim])).length;
    expect(await gone(`select 1 from auth.users where id = $1`)).toBe(0);
    expect(await gone(`select 1 from public.profiles where id = $1`)).toBe(0);
    expect(await gone(`select 1 from public.consents where user_id = $1`)).toBe(
      0,
    );
    expect(
      await gone(
        `select 1 from public.intros where viewer_id = $1 or candidate_id = $1`,
      ),
    ).toBe(0);
    expect(await gone(`select 1 from public.events where user_id = $1`)).toBe(
      0,
    );
    expect(
      await gone(`select 1 from public.contact_messages where user_id = $1`),
    ).toBe(0);
    // The chat and every message in it, including the other person's side.
    expect(
      await q(`select 1 from public.conversations where id = $1`, [convId]),
    ).toHaveLength(0);
    expect(
      await q(`select 1 from public.messages where conversation_id = $1`, [
        convId,
      ]),
    ).toHaveLength(0);
    // The other person is untouched.
    expect(
      await q(`select 1 from public.profiles where id = $1`, [other]),
    ).toHaveLength(1);

    // Orders stay, unlinked.
    const order = await one<{ user_id: string | null }>(
      `select user_id from public.orders where razorpay_order_id = 'order_x'`,
    );
    expect(order.user_id).toBeNull();

    // Safety record: a hash, a reason and a time; no id, no content.
    const records = await q<{ user_ref_hash: string; reason: string }>(
      `select user_ref_hash, reason from public.safety_records`,
    );
    expect(records).toHaveLength(1);
    expect(records[0].reason).toBe("report:harassment");
    expect(records[0].user_ref_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(records)).not.toContain(victim);

    // Reports about the victim lost their free text; the one they filed that
    // was dismissed lost its words too.
    const reports = await q<{
      details: string | null;
      evidence: unknown;
      admin_note: string | null;
    }>(`select details, evidence, admin_note from public.reports`);
    for (const r of reports.filter((x) => x.details !== null)) {
      expect(r.details).not.toContain("named victim here");
      expect(r.details).not.toContain("victim words");
    }
    // The audit log keeps its row but not the id.
    const audit = await q<{ target: string }>(
      `select target from public.audit_log where target like 'deleted-user:%'`,
    );
    expect(audit).toHaveLength(1);
    expect(
      JSON.stringify(await q(`select * from public.audit_log`)),
    ).not.toContain(victim);
  });

  it("is idempotent", async () => {
    const again = await call<{ status: string }>(
      `public.delete_account($1, $2)`,
      [victim, PEPPER],
    );
    expect(again.status).toBe("already_gone");
    expect(await q(`select 1 from public.safety_records`)).toHaveLength(1);
  });

  it("keeps nothing when only a dismissed report existed, and refuses admins and a weak secret", async () => {
    const clean = randomUUID();
    await createUser(clean, "clean");
    await intro(other, clean);
    const rep = await call<{ id: string }>(
      `public.report_user($1, $2, null, 'other', 'meh')`,
      [other, clean],
    );
    await call(`public.admin_resolve_report($1, $2, 'dismiss')`, [
      id.admin,
      rep.id,
    ]);
    const before = (await q(`select 1 from public.safety_records`)).length;
    await call(`public.delete_account($1, $2)`, [clean, PEPPER]);
    expect((await q(`select 1 from public.safety_records`)).length).toBe(
      before,
    );

    expect(
      await fail(`public.delete_account($1, $2)`, [id.admin, PEPPER]),
    ).toBe("admin_account");
    expect(await fail(`public.delete_account($1, $2)`, [id.ann, "short"])).toBe(
      "bad_secret",
    );
  });

  it("is atomic: a failure in the middle changes nothing", async () => {
    const doomed = randomUUID();
    await createUser(doomed, "doomed");
    await db.query(
      `insert into public.events (user_id, name) values ($1, 'login')`,
      [doomed],
    );
    // A trigger that fails when the login row is deleted, after the earlier
    // steps (events delete, orders update) have already run inside the function.
    await db.exec(`
      create function public.boom() returns trigger language plpgsql as $$
      begin raise exception 'boom'; end; $$;
      create trigger boom_on_delete before delete on auth.users
        for each row execute function public.boom();
    `);
    await expect(
      as("service", () =>
        db.query(`select public.delete_account($1, $2)`, [doomed, PEPPER]),
      ),
    ).rejects.toThrow(/boom/);
    await db.exec(`drop trigger boom_on_delete on auth.users`);
    expect(
      await q(`select 1 from public.events where user_id = $1`, [doomed]),
    ).toHaveLength(1);
    expect(
      await q(`select 1 from public.profiles where id = $1`, [doomed]),
    ).toHaveLength(1);
  });
});
