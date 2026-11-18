import { afterAll, describe, expect, it } from "vitest";
import { deleteAccount, removeAllPhotos } from "@/lib/account/delete";
import {
  blockUserInDb,
  endKeptChatInDb,
  getReportInDb,
  reportUserInDb,
  resolveReportInDb,
} from "@/lib/safety/service";
import { PHOTO_BUCKET } from "@/lib/photos";
import {
  TINY_JPEG,
  createMember,
  finishProfile,
  introduce,
  removeMembers,
  service,
  signedInClient,
  uniq,
  type Member,
} from "../support/stack";

// Report, block, suspend, export and account deletion against the real stack:
// real PostgREST calls, real Storage files, real auth users.

const made: Member[] = [];
afterAll(async () => removeMembers(made));

async function people() {
  const city = uniq("City");
  const a = await createMember("SafA");
  const b = await createMember("SafB");
  made.push(a, b);
  await finishProfile(a, { gender: "woman", interestedIn: ["man"], city });
  await finishProfile(b, { gender: "man", interestedIn: ["woman"], city });
  return { a, b };
}

async function chatBetween(a: Member, b: Member, status = "open") {
  const { data } = await service
    .from("conversations")
    .insert({
      user_a: a.id,
      user_b: b.id,
      opener_id: a.id,
      status,
      window_ends_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  return data!.id as string;
}

describe("block", () => {
  it("ends the chat, hides both people from each other, and frees the slot", async () => {
    const { a, b } = await people();
    await introduce(a, b, "2028-03-06");
    const chat = await chatBetween(a, b);
    const out = await blockUserInDb(service, {
      blockerId: a.id,
      targetId: b.id,
    });
    expect(out).toMatchObject({
      ok: true,
      value: { already: false, ended: 1 },
    });

    const { data: c } = await service
      .from("conversations")
      .select("status")
      .eq("id", chat)
      .single();
    expect(c?.status).toBe("blocked");
    for (const [viewer, target] of [
      [a, b],
      [b, a],
    ] as const) {
      const client = await signedInClient(viewer);
      const seen = await client
        .from("profiles")
        .select("id")
        .eq("id", target.id);
      expect(seen.data).toHaveLength(0);
      const mine = await client
        .from("conversations")
        .select("id")
        .in("status", ["open", "kept"]);
      expect(mine.data).toHaveLength(0); // no live chat counts to the cap any more
    }
  });

  it("cannot be done straight from the API (it would skip the limit and leave the chat open)", async () => {
    const { a, b } = await people();
    await introduce(a, b, "2028-03-13");
    const client = await signedInClient(a);
    const { error } = await client
      .from("blocks")
      .insert({ blocker_id: a.id, blocked_id: b.id });
    expect(error?.message).toMatch(/permission denied/);
  });

  it("answers a stranger the same way as a missing person", async () => {
    const { a, b } = await people(); // no intro between them
    const r1 = await blockUserInDb(service, {
      blockerId: a.id,
      targetId: b.id,
    });
    const r2 = await blockUserInDb(service, {
      blockerId: a.id,
      targetId: "00000000-0000-4000-8000-000000000000",
    });
    expect(r1).toEqual({ ok: false, code: "target_not_found" });
    expect(r2).toEqual({ ok: false, code: "target_not_found" });
  });

  it("holds the daily limit under parallel requests", async () => {
    const a = await createMember("Many");
    made.push(a);
    await finishProfile(a, {
      gender: "woman",
      interestedIn: ["man"],
      city: uniq("City"),
    });
    const targets: Member[] = [];
    for (let i = 0; i < 4; i++) {
      const t = await createMember(`Tgt${i}`);
      made.push(t);
      await finishProfile(t, {
        gender: "man",
        interestedIn: ["woman"],
        city: uniq("City"),
      });
      targets.push(t);
    }
    const drop = await introduce(a, targets[0], "2028-04-03");
    void drop;
    for (const t of targets.slice(1))
      await introduce(a, t, "2028-04-03").catch(() => undefined);
    // limit 2 per day, 4 requests at once
    const results = await Promise.all(
      targets.map((t) =>
        service.rpc("block_user", {
          p_blocker: a.id,
          p_target: t.id,
          p_now: new Date().toISOString(),
          p_max_per_day: 2,
        }),
      ),
    );
    const okCount = results.filter((r) => !r.error).length;
    expect(okCount).toBe(2);
  });
});

describe("report and moderation", () => {
  it("copies evidence on the server, hides it from the reporter, and logs the admin who opens it", async () => {
    const { a, b } = await people();
    await introduce(a, b, "2028-05-01");
    const chat = await chatBetween(a, b);
    await service.from("messages").insert([
      {
        conversation_id: chat,
        sender_id: a.id,
        body: "hello there",
        created_at: new Date(Date.now() - 2000).toISOString(),
      },
      {
        conversation_id: chat,
        sender_id: b.id,
        body: "send me money please",
        created_at: new Date(Date.now() - 1000).toISOString(),
      },
    ]);
    const admin = await createMember("Mod", { role: "admin" });
    made.push(admin);

    const r = await reportUserInDb(service, {
      reporterId: a.id,
      targetId: b.id,
      conversationId: chat,
      reason: "scam",
      details: "asked for money",
      attach: true,
    });
    expect(r).toMatchObject({
      ok: true,
      value: { status: "received", evidence_count: 2 },
    });
    if (!r.ok) return;

    // Duplicate while the first is open: the same report comes back.
    const dup = await reportUserInDb(service, {
      reporterId: a.id,
      targetId: b.id,
      conversationId: null,
      reason: "scam",
      details: null,
      attach: false,
    });
    expect(dup).toMatchObject({
      ok: true,
      value: { id: r.value.id, status: "already_reported" },
    });

    // The reporter cannot read the report or write one directly.
    const ac = await signedInClient(a);
    expect((await ac.from("reports").select("id")).data ?? []).toHaveLength(0);
    const direct = await ac
      .from("reports")
      .insert({ reporter_id: a.id, target_id: b.id, reason: "other" });
    expect(direct.error).toBeTruthy();

    // The admin's own session can list reports but cannot select evidence.
    const mc = await signedInClient(admin);
    const list = await mc
      .from("reports")
      .select("id, reason, details")
      .eq("id", r.value.id);
    expect(list.data).toHaveLength(1);
    const peek = await mc.from("reports").select("evidence");
    expect(peek.error?.message).toMatch(/permission denied/);
    // And has no blanket read of messages.
    expect(
      (await mc.from("messages").select("id").eq("conversation_id", chat))
        .data ?? [],
    ).toHaveLength(0);

    const opened = await getReportInDb(service, {
      adminId: admin.id,
      reportId: r.value.id,
      withEvidence: true,
    });
    expect(opened).toMatchObject({ ok: true });
    if (opened.ok)
      expect(opened.value.evidence?.map((e) => e.body)).toEqual([
        "hello there",
        "send me money please",
      ]);
    const { data: audit } = await service
      .from("audit_log")
      .select("action")
      .eq("admin_id", admin.id);
    expect(audit?.map((x) => x.action)).toContain("report_evidence_viewed");

    // Action with suspension: hidden, chat ended, audit written.
    const done = await resolveReportInDb(service, {
      adminId: admin.id,
      reportId: r.value.id,
      action: "action",
      note: "confirmed",
      suspend: true,
    });
    expect(done).toMatchObject({
      ok: true,
      value: { status: "actioned", suspended: true },
    });
    const { data: prof } = await service
      .from("profiles")
      .select("suspended_at")
      .eq("id", b.id)
      .single();
    expect(prof?.suspended_at).toBeTruthy();
    const { data: c } = await service
      .from("conversations")
      .select("status")
      .eq("id", chat)
      .single();
    expect(c?.status).toBe("closed");
    const { data: audit2 } = await service
      .from("audit_log")
      .select("action")
      .eq("admin_id", admin.id);
    expect(audit2?.map((x) => x.action)).toEqual(
      expect.arrayContaining(["user_suspended", "report_actioned"]),
    );
  });

  it("lets a normal user not use the admin functions", async () => {
    const { a, b } = await people();
    const r = await resolveReportInDb(service, {
      adminId: a.id,
      reportId: "00000000-0000-4000-8000-000000000000",
      action: "dismiss",
      note: null,
      suspend: false,
    });
    expect(r).toEqual({ ok: false, code: "not_admin" });
    void b;
  });
});

describe("ending a kept chat", () => {
  it("closes it for both and frees the slot", async () => {
    const { a, b } = await people();
    const chat = await chatBetween(a, b, "kept");
    const r = await endKeptChatInDb(service, {
      userId: b.id,
      conversationId: chat,
      note: "Thank you for chatting.",
    });
    expect(r).toEqual({ ok: true, value: { other_id: a.id } });
    const { data } = await service
      .from("conversations")
      .select("status, closed_by")
      .eq("id", chat)
      .single();
    expect(data).toEqual({ status: "closed", closed_by: b.id });
  });
});

describe("export and deletion with real storage", () => {
  it("exports only the person's own data", async () => {
    const { a, b } = await people();
    const chat = await chatBetween(a, b);
    await service.from("messages").insert([
      { conversation_id: chat, sender_id: a.id, body: "mine-text" },
      { conversation_id: chat, sender_id: b.id, body: "theirs-text" },
    ]);
    const { data, error } = await service.rpc("export_my_data", {
      p_user: a.id,
      p_max_per_day: 3,
    });
    expect(error).toBeNull();
    const text = JSON.stringify(data);
    expect(text).toContain("mine-text");
    expect(text).not.toContain("theirs-text");
    expect(text).not.toContain(b.id);
    expect(text).not.toContain(b.email);
  });

  it("deletes the person, their photo files and their chats, and keeps only the safety record", async () => {
    const { a, b } = await people();
    await introduce(a, b, "2028-06-05");
    const chat = await chatBetween(a, b);
    await service
      .from("messages")
      .insert({ conversation_id: chat, sender_id: a.id, body: "bye" });
    for (let i = 0; i < 3; i++) {
      await service.storage
        .from(PHOTO_BUCKET)
        .upload(`${a.id}/p${i}.jpg`, TINY_JPEG, { contentType: "image/jpeg" });
    }
    // An open report against a, so a safety record must survive.
    const rep = await reportUserInDb(service, {
      reporterId: b.id,
      targetId: a.id,
      conversationId: chat,
      reason: "harassment",
      details: "unique-details-text",
      attach: true,
    });
    expect(rep.ok).toBe(true);
    const before = await service
      .from("safety_records")
      .select("id", { count: "exact", head: true });

    const out = await deleteAccount(service, a.id);
    expect(out).toMatchObject({
      ok: true,
      status: "deleted",
      freedUserIds: [b.id],
    });

    const { data: files } = await service.storage.from(PHOTO_BUCKET).list(a.id);
    expect(files ?? []).toHaveLength(0);
    const { data: user } = await service.auth.admin.getUserById(a.id);
    expect(user.user).toBeNull();
    expect(
      (await service.from("profiles").select("id").eq("id", a.id)).data,
    ).toHaveLength(0);
    expect(
      (await service.from("conversations").select("id").eq("id", chat)).data,
    ).toHaveLength(0);
    expect(
      (await service.from("messages").select("id").eq("conversation_id", chat))
        .data,
    ).toHaveLength(0);
    const after = await service
      .from("safety_records")
      .select("id", { count: "exact", head: true });
    expect((after.count ?? 0) - (before.count ?? 0)).toBe(1);
    const { data: reports } = await service
      .from("reports")
      .select("details, evidence, target_id")
      .eq("id", rep.ok ? rep.value.id : "");
    expect(reports?.[0]).toEqual({
      details: null,
      evidence: null,
      target_id: null,
    });

    // Again: nothing left, still a success.
    const again = await deleteAccount(service, a.id);
    expect(again).toMatchObject({ ok: true, status: "already_gone" });
    // The other person is untouched.
    expect(
      (await service.from("profiles").select("id").eq("id", b.id)).data,
    ).toHaveLength(1);
    expect(await removeAllPhotos(service, a.id)).toBe(0);
  });
});
