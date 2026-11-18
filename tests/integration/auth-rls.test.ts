import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSignupMetadata } from "@/lib/consent";
import {
  PASSWORD,
  anonClient,
  createMember,
  env,
  finishProfile,
  findMail,
  introduce,
  linkIn,
  removeMembers,
  service,
  signedInClient,
  uniq,
  type Member,
} from "../support/stack";

// Sign-up through the real auth service (GoTrue), the confirmation email read
// from the mail catcher, and row level security seen from real signed-in
// clients (not a simulated role switch).

describe("sign-up and email confirmation (real GoTrue + mail catcher)", () => {
  const email = `${uniq("signup")}@example.test`;
  let userId = "";

  afterAll(async () => {
    if (userId) await service.auth.admin.deleteUser(userId);
  });

  it("creates the profile and consent rows from the metadata (trigger)", async () => {
    const client = anonClient();
    const { data, error } = await client.auth.signUp({
      email,
      password: PASSWORD,
      options: {
        data: buildSignupMetadata({
          displayName: "Signup Tester",
          dob: "1996-02-02",
          acceptedTerms: true,
          acceptedPrivacy: true,
        }),
      },
    });
    expect(error).toBeNull();
    userId = data.user!.id;

    const { data: profile } = await service
      .from("profiles")
      .select("display_name, verified_email, role")
      .eq("id", userId)
      .single();
    expect(profile).toEqual({
      display_name: "Signup Tester",
      verified_email: false,
      role: "user",
    });
    const { data: consents } = await service
      .from("consents")
      .select("kind, granted, policy_version")
      .eq("user_id", userId);
    expect(consents?.map((c) => c.kind).sort()).toEqual(["privacy", "terms"]);
  });

  it("refuses to sign in before the email is confirmed", async () => {
    const { error } = await anonClient().auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    expect(error?.code).toBe("email_not_confirmed");
  });

  it("confirms through the emailed link and flips verified_email", async () => {
    const mail = await findMail(email);
    const link = linkIn(mail);
    // Follow the link without leaving the machine: GoTrue answers with a
    // redirect carrying the session (or a code), which means it accepted it.
    const res = await fetch(link, { redirect: "manual" });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.get("location")).toBeTruthy();

    const { data: profile } = await service
      .from("profiles")
      .select("verified_email")
      .eq("id", userId)
      .single();
    expect(profile?.verified_email).toBe(true); // on_auth_user_email_confirmed trigger

    const { data, error } = await anonClient().auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    expect(error).toBeNull();
    expect(data.session).toBeTruthy();
  });

  it("rejects an under-18 date of birth and missing consent at the database", async () => {
    const young = await anonClient().auth.signUp({
      email: `${uniq("young")}@example.test`,
      password: PASSWORD,
      options: {
        data: buildSignupMetadata({
          displayName: "Young",
          dob: new Date(Date.now() - 16 * 365 * 24 * 3600 * 1000)
            .toISOString()
            .slice(0, 10),
          acceptedTerms: true,
          acceptedPrivacy: true,
        }),
      },
    });
    expect(young.error).toBeTruthy();
    const noConsent = await anonClient().auth.signUp({
      email: `${uniq("noconsent")}@example.test`,
      password: PASSWORD,
      options: { data: { display_name: "X", dob: "1990-01-01" } },
    });
    expect(noConsent.error).toBeTruthy();
  });
});

describe("row level security from real clients", () => {
  let alice: Member;
  let bob: Member;
  let carol: Member;
  const city = uniq("City");

  beforeAll(async () => {
    alice = await createMember("Alice");
    bob = await createMember("Bob");
    carol = await createMember("Carol");
    await finishProfile(alice, {
      gender: "woman",
      interestedIn: ["man"],
      city,
    });
    await finishProfile(bob, { gender: "man", interestedIn: ["woman"], city });
    await finishProfile(carol, {
      gender: "woman",
      interestedIn: ["man"],
      city,
    });
    await introduce(alice, bob, "2026-11-02");
  });
  afterAll(async () => removeMembers([alice, bob, carol]));

  it("lets a person read their own profile but not the birth date column", async () => {
    const a = await signedInClient(alice);
    const mine = await a
      .from("profiles")
      .select("display_name, city")
      .eq("id", alice.id)
      .single();
    expect(mine.data?.display_name).toBe("Alice");
    const dob = await a.from("profiles").select("dob").eq("id", alice.id);
    expect(dob.error?.message).toMatch(/permission denied/);
    const hash = await a
      .from("profiles")
      .select("elitmus_ref_hash")
      .eq("id", alice.id);
    expect(hash.error?.message).toMatch(/permission denied/);
  });

  it("shows a profile only to someone who was introduced, never to a stranger", async () => {
    const a = await signedInClient(alice);
    const seesBob = await a.from("profiles").select("id").eq("id", bob.id);
    expect(seesBob.data).toHaveLength(1);
    const c = await signedInClient(carol);
    const seesBobToo = await c.from("profiles").select("id").eq("id", bob.id);
    expect(seesBobToo.data).toHaveLength(0);
    const all = await c.from("profiles").select("id");
    expect(all.data?.map((r) => r.id)).toEqual([carol.id]);
  });

  it("keeps a visitor with no login out of everything", async () => {
    const anon = anonClient();
    for (const table of [
      "profiles",
      "intros",
      "conversations",
      "messages",
      "reports",
      "blocks",
    ]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(data ?? []).toHaveLength(0);
      expect(error === null || /permission denied/.test(error.message)).toBe(
        true,
      );
    }
  });

  it("lets a person edit allowed profile fields but not promote themselves", async () => {
    const a = await signedInClient(alice);
    const ok = await a
      .from("profiles")
      .update({ occupation: "Designer" })
      .eq("id", alice.id);
    expect(ok.error).toBeNull();
    for (const patch of [
      { role: "admin" },
      { plus_until: "2099-01-01T00:00:00Z" },
      { suspended_at: null },
      { elitmus_status: "verified" },
    ]) {
      const bad = await a.from("profiles").update(patch).eq("id", alice.id);
      expect(bad.error?.message).toMatch(/permission denied/);
    }
    // And not somebody else's row.
    await a.from("profiles").update({ occupation: "Hacked" }).eq("id", bob.id);
    const { data } = await service
      .from("profiles")
      .select("occupation")
      .eq("id", bob.id)
      .single();
    expect(data?.occupation).toBe("Engineer");
  });

  it("does not let a user read the other person's intro or write one", async () => {
    const b = await signedInClient(bob);
    const mine = await b.from("intros").select("viewer_id");
    expect(new Set(mine.data?.map((r) => r.viewer_id))).toEqual(
      new Set([bob.id]),
    );
    const insert = await b
      .from("intros")
      .update({ status: "interested" })
      .eq("viewer_id", alice.id);
    expect(insert.error?.message ?? "permission denied").toMatch(
      /permission denied/,
    );
  });

  it("completes onboarding only when the profile really is complete", async () => {
    const fresh = await createMember("Fresh");
    try {
      const c = await signedInClient(fresh);
      const early = await c.rpc("complete_onboarding");
      expect(early.data).toBe(false);
      await finishProfile(fresh, {
        gender: "woman",
        interestedIn: ["man"],
        city,
      });
      await service
        .from("profiles")
        .update({ onboarding_completed_at: null })
        .eq("id", fresh.id);
      const done = await c.rpc("complete_onboarding");
      expect(done.data).toBe(true);
    } finally {
      await removeMembers([fresh]);
    }
  });

  it("does not let a signed-in user call the server-only database functions", async () => {
    const a = await signedInClient(alice);
    const calls = await Promise.all([
      a.rpc("decide_intro", {
        p_viewer: alice.id,
        p_intro: alice.id,
        p_decision: "passed",
      }),
      a.rpc("send_message", {
        p_sender: alice.id,
        p_conversation: alice.id,
        p_body: "hi",
      }),
      a.rpc("block_user", { p_blocker: alice.id, p_target: bob.id }),
      a.rpc("delete_account", { p_user: alice.id, p_pepper: "x".repeat(20) }),
      a.rpc("export_my_data", { p_user: bob.id }),
    ]);
    for (const r of calls)
      expect(r.error?.message).toMatch(
        /permission denied|not found|Could not find/i,
      );
  });
});

describe("the test tools stay on this machine", () => {
  it("only talks to a local Supabase", () => {
    expect(env.url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost)/);
  });
});
