import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideIntro } from "@/lib/shortlist/decide";
import { outcomeFromResult } from "@/lib/shortlist/service";

// Regression test for a bug the browser tests found: after a chat ended, the
// "retry waiting matches" step opened a second chat with the same person.

let db: PGlite;
const woman = randomUUID();
const man = randomUUID();
let introW: string;
let introM: string;

async function decideAs(viewer: string, intro: string) {
  await db.exec("set role service_role");
  try {
    const r = await db.query<{ r: Record<string, string> }>(
      `select public.decide_intro($1, $2, 'interested', null, '2026-11-18T10:00:00Z') as r`,
      [viewer, intro],
    );
    return r.rows[0].r;
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    readFileSync(join(process.cwd(), "tests/rls/bootstrap.sql"), "utf8"),
  );
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  for (const [id, name] of [
    [woman, "w"],
    [man, "m"],
  ] as const) {
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [
        id,
        `${name}@example.com`,
        JSON.stringify({
          display_name: name,
          dob: "1997-01-01",
          accepted_terms: "true",
          accepted_privacy: "true",
          consent_version: "v1",
        }),
      ],
    );
  }
  await db.query(
    `update public.profiles set gender = 'woman', onboarding_completed_at = now() where id = $1`,
    [woman],
  );
  await db.query(
    `update public.profiles set gender = 'man', onboarding_completed_at = now() where id = $1`,
    [man],
  );
  const drop = (
    await db.query<{ id: string }>(
      `insert into public.drops (week_start) values ('2026-11-16') returning id`,
    )
  ).rows[0].id;
  introW = (
    await db.query<{ id: string }>(
      `insert into public.intros (drop_id, viewer_id, candidate_id) values ($1, $2, $3) returning id`,
      [drop, woman, man],
    )
  ).rows[0].id;
  introM = (
    await db.query<{ id: string }>(
      `insert into public.intros (drop_id, viewer_id, candidate_id) values ($1, $2, $3) returning id`,
      [drop, man, woman],
    )
  ).rows[0].id;
});
afterAll(async () => db.close());

describe("one chat per mutual interest", () => {
  it("opens once, and a retry after the chat ended does not open another", async () => {
    expect((await decideAs(man, introM)).status).toBe("interest_saved");
    const first = await decideAs(woman, introW);
    expect(first.status).toBe("opened");

    // The chat ends (closed kindly, expired and blocked all end like this).
    for (const how of ["closed", "expired", "blocked"]) {
      await db.query(`update public.conversations set status = $1`, [how]);
      const again = await decideAs(woman, introW);
      expect(again).toMatchObject({
        status: "interest_saved",
        reason: "already_chatted",
      });
      const again2 = await decideAs(man, introM);
      expect(again2).toMatchObject({
        status: "interest_saved",
        reason: "already_chatted",
      });
    }
    const n = await db.query(`select id from public.conversations`);
    expect(n.rows).toHaveLength(1);
  });

  it("the TypeScript rules and the app's reading of the answer agree", () => {
    expect(
      outcomeFromResult(
        { status: "interest_saved", reason: "already_chatted" },
        "me",
      ),
    ).toEqual({
      kind: "interest_saved",
      reason: "already_chatted",
    });
    const person = {
      id: "a",
      gender: "woman" as const,
      openChats: 0,
      cap: 3,
      available: true,
    };
    const outcome = decideIntro(
      {
        decision: "interested",
        viewer: person,
        intro: {
          ownerId: "a",
          status: "interested",
          expired: false,
          decidedAtMs: 1,
        },
        other: {
          ...person,
          id: "b",
          gender: "man",
          blocked: false,
          introStatus: "interested",
          introDecidedAtMs: 2,
        },
        hasLiveChat: false,
        hadChatFromTheseIntros: true,
      },
      { womanOpens: true },
    );
    expect(outcome).toEqual({
      kind: "interest_saved",
      reason: "already_chatted",
    });
  });
});
