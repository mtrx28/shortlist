import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendMessageInDb } from "@/lib/conversation/service";
import {
  createMember,
  finishProfile,
  removeMembers,
  service,
  signedInClient,
  warmUpRealtime,
  uniq,
  type Member,
} from "../support/stack";

// Supabase Realtime for the messages table: who receives an insert, and what
// the payload contains. This is the part the earlier milestones could not test.

type Payload = { new: Record<string, unknown> };

function listen(client: SupabaseClient, name: string, filter?: string) {
  const events: Payload[] = [];
  const channel: RealtimeChannel = client.channel(name).on(
    "postgres_changes" as never,
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
      ...(filter ? { filter } : {}),
    } as never,
    (p: Payload) => events.push(p),
  );
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`channel ${name} never subscribed`)),
      20_000,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return { events, channel, ready };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) await wait(100);
}

describe("Realtime delivery of new messages", () => {
  let woman: Member;
  let man: Member;
  let outsider: Member;
  let chatId: string;
  const clients: SupabaseClient[] = [];

  beforeAll(async () => {
    await warmUpRealtime();
    const city = uniq("City");
    woman = await createMember("RtW");
    man = await createMember("RtM");
    outsider = await createMember("RtO");
    await finishProfile(woman, {
      gender: "woman",
      interestedIn: ["man"],
      city,
    });
    await finishProfile(man, { gender: "man", interestedIn: ["woman"], city });
    await finishProfile(outsider, {
      gender: "man",
      interestedIn: ["woman"],
      city,
    });
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
    chatId = data!.id as string;
  });
  afterAll(async () => {
    for (const c of clients) await c.removeAllChannels();
    await removeMembers([woman, man, outsider]);
  });

  it("reaches both people in the chat, not a stranger, and hides internal columns", async () => {
    const [wc, mc, oc] = await Promise.all([
      signedInClient(woman),
      signedInClient(man),
      signedInClient(outsider),
    ]);
    clients.push(wc, mc, oc);
    // The outsider listens with NO filter at all: the strongest test that
    // row level security, not the filter, is what keeps them out.
    const w = listen(wc, "w", `conversation_id=eq.${chatId}`);
    const m = listen(mc, "m", `conversation_id=eq.${chatId}`);
    const o = listen(oc, "o");
    await Promise.all([w.ready, m.ready, o.ready]);
    await wait(3000); // the server registers the subscription a moment after "SUBSCRIBED"

    const sent = await sendMessageInDb(service, {
      senderId: woman.id,
      conversationId: chatId,
      body: "Hello over realtime",
      flagged: true, // flagged on purpose, to see whether it leaks
    });
    expect(sent).toMatchObject({ ok: true });

    await until(() => w.events.length > 0 && m.events.length > 0, 10_000);
    await wait(3000); // give a wrong delivery to the outsider time to show up

    expect(m.events).toHaveLength(1);
    expect(m.events[0].new.body).toBe("Hello over realtime");
    expect(w.events).toHaveLength(1); // the sender's other tab gets it too
    expect(o.events).toHaveLength(0);

    // Record what the payload carries. The `flagged` moderation column must
    // not reach members; see the finding in the build notes if it does.
    const keys = Object.keys(m.events[0].new).sort();
    expect(keys).not.toContain("flagged");
    expect(keys).toEqual([
      "body",
      "conversation_id",
      "created_at",
      "id",
      "sender_id",
    ]);
  });

  it("stops delivering once the chat has ended", async () => {
    const mc = await signedInClient(man);
    clients.push(mc);
    const m = listen(mc, "m2", `conversation_id=eq.${chatId}`);
    await m.ready;
    await service
      .from("conversations")
      .update({ status: "closed" })
      .eq("id", chatId);
    // A message cannot be sent into a closed chat, so insert one as the server
    // would in a bug: it still must not reach the member.
    await service
      .from("messages")
      .insert({ conversation_id: chatId, sender_id: woman.id, body: "late" });
    await wait(3000);
    expect(m.events).toHaveLength(0);
  });
});
