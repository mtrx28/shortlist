import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for the onboarding migration: the completed flag, profile limits, the
// pH hash rules and the photo storage policies. Same approach as rls.test.ts:
// run the real migrations in PGlite and act as different users.
// Storage here is a two-table stand-in (see tests/rls/bootstrap.sql). The
// policies are real; the Storage service itself (uploads, signed URLs, MIME
// and size limits) is NOT tested.

const root = process.cwd();
let db: PGlite;

const ids = {
  alice: randomUUID(), // was shown Bob in an intro
  bob: randomUUID(),
  carol: randomUUID(), // stranger
  dave: randomUUID(), // blocked by Bob
  erin: randomUUID(),
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
  who: string | null | "service",
  fn: () => Promise<T>,
): Promise<T> {
  const role =
    who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    who && who !== "service" ? who : "",
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

const photoPath = (owner: string) => `${owner}/${randomUUID()}.webp`;

// Fills in everything complete_onboarding() asks for, as the service would.
async function fillProfile(id: string) {
  const answers = Object.fromEntries(
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => [
      k,
      { answer: "x", dealBreaker: false },
    ]),
  );
  await db.query(
    `update public.profiles set gender = 'woman', interested_in = '{man}', city = 'Pune',
       intent = 'serious', batch_year = 2022, occupation = 'Analyst',
       values_answers = $2, bio_prompts = '[{"id":"p","answer":"hello there"},{},{}]',
       interests = '{a,b,c}', photos = $3
     where id = $1`,
    [id, JSON.stringify(answers), [photoPath(id)]],
  );
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
  for (const [name, id] of Object.entries(ids)) await createUser(id, name);

  const [drop] = await rows(
    `insert into public.drops (week_start) values ('2026-11-15') returning id`,
  );
  // Alice was shown Bob, so she may see Bob's photos.
  await db.query(
    `insert into public.intros (drop_id, viewer_id, candidate_id) values ($1, $2, $3)`,
    [drop.id, ids.alice, ids.bob],
  );
  // Dave was shown Bob too, but Bob blocked Dave.
  await db.query(
    `insert into public.intros (drop_id, viewer_id, candidate_id) values ($1, $2, $3)`,
    [drop.id, ids.dave, ids.bob],
  );
  await db.query(
    `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
    [ids.bob, ids.dave],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("onboarding completed flag", () => {
  it("can be read but not written by the user", async () => {
    const own = await actAs(ids.carol, () =>
      rows(
        `select onboarding_completed_at from public.profiles where id = $1`,
        [ids.carol],
      ),
    );
    expect(own[0].onboarding_completed_at).toBeNull();
    await expect(
      actAs(ids.carol, () =>
        db.query(
          `update public.profiles set onboarding_completed_at = now() where id = $1`,
          [ids.carol],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("is not set when the profile is incomplete", async () => {
    const done = await actAs(ids.carol, () =>
      rows(`select public.complete_onboarding() as ok`),
    );
    expect(done[0].ok).toBe(false);
    const [p] = await rows(
      `select onboarding_completed_at from public.profiles where id = $1`,
      [ids.carol],
    );
    expect(p.onboarding_completed_at).toBeNull();
  });

  it("is set once every part is filled in, and only for the caller", async () => {
    await fillProfile(ids.erin);
    const done = await actAs(ids.erin, () =>
      rows(`select public.complete_onboarding() as ok`),
    );
    expect(done[0].ok).toBe(true);
    const [erin] = await rows(
      `select onboarding_completed_at from public.profiles where id = $1`,
      [ids.erin],
    );
    expect(erin.onboarding_completed_at).not.toBeNull();
    const [carol] = await rows(
      `select onboarding_completed_at from public.profiles where id = $1`,
      [ids.carol],
    );
    expect(carol.onboarding_completed_at).toBeNull();
  });

  it("keeps the first completion time when called again", async () => {
    const [before] = await rows(
      `select onboarding_completed_at as t from public.profiles where id = $1`,
      [ids.erin],
    );
    await actAs(ids.erin, () => rows(`select public.complete_onboarding()`));
    const [after] = await rows(
      `select onboarding_completed_at as t from public.profiles where id = $1`,
      [ids.erin],
    );
    expect(after.t).toEqual(before.t);
  });

  it.each([
    ["no photo", `photos = '{}'`],
    ["two interests", `interests = '{a,b}'`],
    ["two prompts", `bio_prompts = '[{},{}]'::jsonb`],
    [
      "seven answers",
      `values_answers = '{"a":{},"b":{},"c":{},"d":{},"e":{},"f":{},"g":{}}'::jsonb`,
    ],
    ["no city", `city = null`],
    ["nobody to meet", `interested_in = '{}'`],
  ])("refuses to complete with %s", async (_name, change) => {
    const id = randomUUID();
    await createUser(id, "partial");
    await fillProfile(id);
    await db.query(`update public.profiles set ${change} where id = $1`, [id]);
    const done = await actAs(id, () =>
      rows(`select public.complete_onboarding() as ok`),
    );
    expect(done[0].ok).toBe(false);
  });

  it("cannot be called by a visitor who is not signed in", async () => {
    await expect(
      actAs(null, () => rows(`select public.complete_onboarding()`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("limits on the profile arrays and JSON", () => {
  it("accepts up to 4 photos in your own folder", async () => {
    const paths = [1, 2, 3, 4].map(() => photoPath(ids.carol));
    await actAs(ids.carol, () =>
      db.query(`update public.profiles set photos = $2 where id = $1`, [
        ids.carol,
        paths,
      ]),
    );
    const [p] = await rows(
      `select cardinality(photos) as n from public.profiles where id = $1`,
      [ids.carol],
    );
    expect(p.n).toBe(4);
  });

  it("rejects a fifth photo", async () => {
    const paths = [1, 2, 3, 4, 5].map(() => photoPath(ids.carol));
    await expect(
      actAs(ids.carol, () =>
        db.query(`update public.profiles set photos = $2 where id = $1`, [
          ids.carol,
          paths,
        ]),
      ),
    ).rejects.toThrow(/profiles_photos_valid/);
  });

  it("rejects a photo path that points into someone else's folder", async () => {
    await expect(
      actAs(ids.carol, () =>
        db.query(`update public.profiles set photos = $2 where id = $1`, [
          ids.carol,
          [photoPath(ids.bob)],
        ]),
      ),
    ).rejects.toThrow(/profiles_photos_valid/);
  });

  it("rejects wrongly shaped or oversized prompts and answers", async () => {
    const update = (column: string, value: string) =>
      actAs(ids.carol, () =>
        db.query(
          `update public.profiles set ${column} = $2::jsonb where id = $1`,
          [ids.carol, value],
        ),
      );
    await expect(update("bio_prompts", `{"a":1}`)).rejects.toThrow(
      /profiles_bio_prompts_shape/,
    );
    await expect(
      update("bio_prompts", JSON.stringify([{ answer: "x".repeat(5000) }])),
    ).rejects.toThrow(/profiles_bio_prompts_shape/);
    await expect(update("values_answers", `[]`)).rejects.toThrow(
      /profiles_values_answers_shape/,
    );
  });

  it("rejects too many interests", async () => {
    await expect(
      actAs(ids.carol, () =>
        db.query(`update public.profiles set interests = $2 where id = $1`, [
          ids.carol,
          Array.from({ length: 11 }, (_, i) => `i${i}`),
        ]),
      ),
    ).rejects.toThrow(/profiles_interests_size/);
  });
});

describe("pause and eLitmus verification", () => {
  it("lets a user pause and unpause their own profile", async () => {
    await actAs(ids.carol, () =>
      db.query(`update public.profiles set paused = true where id = $1`, [
        ids.carol,
      ]),
    );
    const [p] = await rows(`select paused from public.profiles where id = $1`, [
      ids.carol,
    ]);
    expect(p.paused).toBe(true);
    await actAs(ids.carol, () =>
      db.query(`update public.profiles set paused = false where id = $1`, [
        ids.carol,
      ]),
    );
  });

  it("does not let a user pause someone else", async () => {
    await actAs(ids.alice, () =>
      db.query(`update public.profiles set paused = true where id = $1`, [
        ids.bob,
      ]),
    );
    const [p] = await rows(`select paused from public.profiles where id = $1`, [
      ids.bob,
    ]);
    expect(p.paused).toBe(false);
  });

  it("does not let a user write their own verification status or hash", async () => {
    for (const assignment of [
      `elitmus_status = 'verified'`,
      `elitmus_status = 'pending'`,
      `elitmus_ref_hash = 'abc'`,
    ]) {
      await expect(
        actAs(ids.carol, () =>
          db.query(`update public.profiles set ${assignment} where id = $1`, [
            ids.carol,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("lets the server (service role) set status and hash", async () => {
    await actAs("service", () =>
      db.query(
        `update public.profiles set elitmus_status = 'pending', elitmus_ref_hash = 'hash-one' where id = $1`,
        [ids.carol],
      ),
    );
    const [p] = await rows(
      `select elitmus_status from public.profiles where id = $1`,
      [ids.carol],
    );
    expect(p.elitmus_status).toBe("pending");
  });

  it("refuses the same pH ID hash on a second account", async () => {
    await expect(
      actAs("service", () =>
        db.query(
          `update public.profiles set elitmus_ref_hash = 'hash-one' where id = $1`,
          [ids.alice],
        ),
      ),
    ).rejects.toThrow(/profiles_elitmus_ref_hash_key|unique/);
  });

  it("allows many accounts to have no hash", async () => {
    const [n] = await rows(
      `select count(*)::int as n from public.profiles where elitmus_ref_hash is null`,
    );
    expect(n.n).toBeGreaterThan(1);
  });

  it("never lets the hash be read back by users", async () => {
    await expect(
      actAs(ids.carol, () =>
        rows(`select elitmus_ref_hash from public.profiles`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("photo storage policies", () => {
  const insertObject = (who: string | null, name: string) =>
    actAs(who, () =>
      db.query(
        `insert into storage.objects (bucket_id, name) values ('profile-photos', $1)`,
        [name],
      ),
    );
  const visible = async (who: string, name: string) =>
    (
      await actAs(who, () =>
        rows(
          `select name from storage.objects where bucket_id = 'profile-photos' and name = $1`,
          [name],
        ),
      )
    ).length === 1;

  const bobPhoto = photoPath(ids.bob);

  it("creates a private bucket that allows only images up to 5 MB", async () => {
    const [b] = await rows(
      `select * from storage.buckets where id = 'profile-photos'`,
    );
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(5242880);
    expect(b.allowed_mime_types).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("lets a user upload into their own folder", async () => {
    await insertObject(ids.bob, bobPhoto);
    expect(await visible(ids.bob, bobPhoto)).toBe(true);
  });

  it("refuses uploads into another user's folder", async () => {
    await expect(insertObject(ids.carol, photoPath(ids.bob))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("refuses uploads outside any user folder, or with a non-id folder", async () => {
    await expect(insertObject(ids.carol, "loose-file.webp")).rejects.toThrow(
      /row-level security/,
    );
    await expect(
      insertObject(ids.carol, "not-a-uuid/file.webp"),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses uploads for visitors who are not signed in", async () => {
    await expect(insertObject(null, photoPath(ids.carol))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("lets someone who was introduced to Bob see his photo", async () => {
    expect(await visible(ids.alice, bobPhoto)).toBe(true);
  });

  it("hides his photo from a stranger", async () => {
    expect(await visible(ids.carol, bobPhoto)).toBe(false);
  });

  it("hides his photo from someone he blocked, even with an intro", async () => {
    expect(await visible(ids.dave, bobPhoto)).toBe(false);
  });

  it("does not let others delete or overwrite his photo", async () => {
    await actAs(ids.alice, () =>
      db.query(`delete from storage.objects where name = $1`, [bobPhoto]),
    );
    await actAs(ids.alice, () =>
      db.query(`update storage.objects set name = $2 where name = $1`, [
        bobPhoto,
        photoPath(ids.alice),
      ]),
    );
    expect(await visible(ids.bob, bobPhoto)).toBe(true);
  });

  it("does not let an owner rename a file into someone else's folder", async () => {
    await expect(
      actAs(ids.bob, () =>
        db.query(`update storage.objects set name = $2 where name = $1`, [
          bobPhoto,
          photoPath(ids.carol),
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets the owner delete their own photo", async () => {
    const mine = photoPath(ids.bob);
    await insertObject(ids.bob, mine);
    await actAs(ids.bob, () =>
      db.query(`delete from storage.objects where name = $1`, [mine]),
    );
    expect(await visible(ids.bob, mine)).toBe(false);
  });

  it("caps a user at 8 files in their folder", async () => {
    const id = randomUUID();
    await createUser(id, "uploader");
    for (let i = 0; i < 8; i++) await insertObject(id, photoPath(id));
    await expect(insertObject(id, photoPath(id))).rejects.toThrow(
      /row-level security/,
    );
  });
});
