import { afterAll, describe, expect, it } from "vitest";
import {
  createMember,
  finishProfile,
  introduce,
  removeMembers,
  service,
  uniq,
  type Member,
} from "../support/stack";
import { decideIntroInDb } from "@/lib/shortlist/service";
import { sendMessageInDb } from "@/lib/conversation/service";

// The chat database functions called through real PostgREST, and under true
// parallelism (separate connections), which the in-process tests cannot show.

let weekCounter = 0;
const nextWeek = () =>
  `2027-0${1 + Math.floor(weekCounter / 4)}-${String(1 + (weekCounter++ % 4) * 7).padStart(2, "0")}`;

async function pair(prefix: string) {
  const city = uniq("City");
  const woman = await createMember(`${prefix}W`);
  const man = await createMember(`${prefix}M`);
  await finishProfile(woman, { gender: "woman", interestedIn: ["man"], city });
  await finishProfile(man, { gender: "man", interestedIn: ["woman"], city });
  return { woman, man, city };
}

describe("decide_intro through PostgREST", () => {
  const made: Member[] = [];
  afterAll(async () => removeMembers(made));

  it("opens exactly one chat when both people press Interested at the same moment", async () => {
    const { woman, man } = await pair("Race");
    made.push(woman, man);
    const { introOf } = await introduce(woman, man, "2028-01-03");

    // 8 parallel calls: the same two intros, both directions, repeated.
    const calls = [];
    for (let i = 0; i < 4; i++) {
      calls.push(
        decideIntroInDb(service, {
          viewerId: woman.id,
          introId: introOf(woman),
          decision: "interested",
          note: null,
        }),
        decideIntroInDb(service, {
          viewerId: man.id,
          introId: introOf(man),
          decision: "interested",
          note: null,
        }),
      );
    }
    const results = await Promise.all(calls);
    expect(results.every((r) => r !== null)).toBe(true);
    const opened = results.filter((r) => r?.outcome.kind === "opened");
    expect(opened).toHaveLength(1);

    const { data: chats } = await service
      .from("conversations")
      .select("id, opener_id, status")
      .in("user_a", [woman.id, man.id])
      .in("user_b", [woman.id, man.id]);
    expect(chats).toHaveLength(1);
    expect(chats![0].opener_id).toBe(woman.id); // woman-first rule
  });

  it("never lets a person go over the chat cap when two chats race for the last slot", async () => {
    const city = uniq("City");
    const x = await createMember("CapX");
    const p1 = await createMember("CapP1");
    const p2 = await createMember("CapP2");
    const fillers = [await createMember("CapF1"), await createMember("CapF2")];
    made.push(x, p1, p2, ...fillers);
    await finishProfile(x, { gender: "woman", interestedIn: ["man"], city });
    for (const m of [p1, p2, ...fillers]) {
      await finishProfile(m, { gender: "man", interestedIn: ["woman"], city });
    }
    // X already has 2 open chats (cap is 3), so exactly one slot is left.
    for (const f of fillers) {
      await service.from("conversations").insert({
        user_a: x.id,
        user_b: f.id,
        opener_id: x.id,
        status: "open",
        window_ends_at: new Date(
          Date.now() + 3 * 24 * 3600 * 1000,
        ).toISOString(),
      });
    }
    const a = await introduce(x, p1, "2028-02-07");
    const b = await introduce(x, p2, "2028-02-07");
    // Both men already said Interested.
    await service
      .from("intros")
      .update({ status: "interested", decided_at: new Date().toISOString() })
      .in("id", [a.introOf(p1), b.introOf(p2)]);

    const [r1, r2] = await Promise.all([
      decideIntroInDb(service, {
        viewerId: x.id,
        introId: a.introOf(x),
        decision: "interested",
        note: null,
      }),
      decideIntroInDb(service, {
        viewerId: x.id,
        introId: b.introOf(x),
        decision: "interested",
        note: null,
      }),
    ]);
    const kinds = [r1?.outcome.kind, r2?.outcome.kind].sort();
    expect(kinds).toEqual(["opened", "viewer_at_cap"]);

    const { count } = await service
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "kept"])
      .or(`user_a.eq.${x.id},user_b.eq.${x.id}`);
    expect(count).toBe(3);
  });
});

describe("send_message through PostgREST", () => {
  const made: Member[] = [];
  afterAll(async () => removeMembers(made));

  async function openChat() {
    const { woman, man } = await pair("Msg");
    made.push(woman, man);
    const { data } = await service
      .from("conversations")
      .insert({
        user_a: woman.id,
        user_b: man.id,
        opener_id: woman.id,
        status: "open",
        window_ends_at: new Date(
          Date.now() + 3 * 24 * 3600 * 1000,
        ).toISOString(),
      })
      .select("id")
      .single();
    return { woman, man, chatId: data!.id as string };
  }

  it("follows the opener rules and records the message", async () => {
    const { woman, man, chatId } = await openChat();
    const early = await sendMessageInDb(service, {
      senderId: man.id,
      conversationId: chatId,
      body: "hi",
      flagged: false,
    });
    expect(early).toEqual({ ok: false, code: "wait_for_opener" });
    const first = await sendMessageInDb(service, {
      senderId: woman.id,
      conversationId: chatId,
      body: "Hello!",
      flagged: false,
    });
    expect(first).toMatchObject({
      ok: true,
      firstFromSender: true,
      firstReply: false,
    });
    const reply = await sendMessageInDb(service, {
      senderId: man.id,
      conversationId: chatId,
      body: "Hi!",
      flagged: false,
    });
    expect(reply).toMatchObject({ ok: true, firstReply: true });
  });

  it("holds the per-minute limit even when many sends arrive at the same instant", async () => {
    const { woman, man, chatId } = await openChat();
    await sendMessageInDb(service, {
      senderId: woman.id,
      conversationId: chatId,
      body: "start",
      flagged: false,
    });
    await sendMessageInDb(service, {
      senderId: man.id,
      conversationId: chatId,
      body: "reply",
      flagged: false,
    });
    // The woman has sent 1. The limit is 8 a minute, so 7 more may pass.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        sendMessageInDb(service, {
          senderId: woman.id,
          conversationId: chatId,
          body: `m${i}`,
          flagged: false,
        }),
      ),
    );
    const ok = results.filter((r) => r?.ok).length;
    const limited = results.filter(
      (r) => r && !r.ok && r.code === "rate_limited",
    ).length;
    expect(ok).toBe(7);
    expect(limited).toBe(13);
    const { count } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", chatId)
      .eq("sender_id", woman.id);
    expect(count).toBe(8);
  });

  it("refuses a stranger and a blocked person", async () => {
    const { woman, man, chatId } = await openChat();
    const outsider = await createMember("Outsider");
    made.push(outsider);
    const r = await sendMessageInDb(service, {
      senderId: outsider.id,
      conversationId: chatId,
      body: "hi",
      flagged: false,
    });
    expect(r).toEqual({ ok: false, code: "not_participant" });
    await introduce(woman, man, nextWeek());
    await service.rpc("block_user", { p_blocker: man.id, p_target: woman.id });
    const after = await sendMessageInDb(service, {
      senderId: woman.id,
      conversationId: chatId,
      body: "hello?",
      flagged: false,
    });
    expect(after).toMatchObject({ ok: false });
  });
});
