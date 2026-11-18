import Link from "next/link";
import { redirect } from "next/navigation";
import { Countdown } from "@/components/shortlist/countdown";
import { logEvent } from "@/lib/events";
import { homeRedirect } from "@/lib/onboarding";
import { requireUserProfile } from "@/lib/profile";
import { capStatusText, chatCap } from "@/lib/shortlist/caps";
import { retryWaitingChats } from "@/lib/shortlist/service";
import { createAdminClient } from "@/lib/supabase/admin";

// Reads the session and the clock, so it must never be prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "Chats | Shortlist" };

type Conversation = {
  id: string;
  user_a: string;
  user_b: string;
  opener_id: string;
  status: "open" | "kept";
  window_ends_at: string;
};

// A simple list of open chats, so the result of "Interested" is visible. The
// chat itself (messages, the day-3 decision) is the next milestone.
export default async function ChatListPage() {
  const { supabase, userId, profile, state } = await requireUserProfile();
  const away = homeRedirect(state);
  if (away) redirect(away);

  const now = new Date();
  const { data: plus } = await supabase
    .from("profiles")
    .select("plus_until")
    .eq("id", userId)
    .maybeSingle();
  const cap = chatCap((plus?.plus_until as string | null) ?? null, now);

  const load = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, user_a, user_b, opener_id, status, window_ends_at")
      .in("status", ["open", "kept"])
      .order("opened_at", { ascending: false });
    return (data ?? []) as Conversation[];
  };

  let chats = await load();
  const service = createAdminClient();
  if (service && !profile.paused && chats.length < cap) {
    const opened = await retryWaitingChats(service, userId, cap, now);
    await Promise.all(
      opened.map(() =>
        logEvent("conversation_opened", userId, { source: "retry" }),
      ),
    );
    if (opened.length > 0) chats = await load();
  }

  const otherIds = chats.map((c) =>
    c.user_a === userId ? c.user_b : c.user_a,
  );
  const { data: people } = otherIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", otherIds)
    : { data: [] };
  const nameOf = new Map(
    (people ?? []).map((p) => [p.id as string, p.display_name as string]),
  );

  // The note the other person wrote with their Interested, shown now that
  // you are both in a chat.
  const theirNote = new Map<string, string>();
  await Promise.all(
    chats.map(async (chat) => {
      const { data } = await supabase.rpc("conversation_intro_notes", {
        p_conversation: chat.id,
      });
      const note = ((data ?? []) as { author_id: string; note: string }[]).find(
        (n) => n.author_id !== userId,
      );
      if (note) theirNote.set(chat.id, note.note);
    }),
  );

  const renderedAt = now.toISOString();

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Chats</h1>
          <Link href="/shortlist" className="text-sm underline">
            Shortlist
          </Link>
        </div>
        <p className="text-sm">{capStatusText(chats.length, cap)}</p>
        <p className="text-muted-foreground text-sm">
          You can have {cap} chats open at once. A new chat opens when you both
          say Interested and you both have a free slot.
        </p>
      </div>

      {chats.length === 0 && (
        <div className="space-y-2 rounded-lg border p-4">
          <h2 className="text-base font-medium">No chats yet</h2>
          <p className="text-muted-foreground text-sm">
            When someone you are interested in is interested in you too, the
            chat shows up here.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {chats.map((chat) => {
          const otherId = chat.user_a === userId ? chat.user_b : chat.user_a;
          const youWriteFirst = chat.opener_id === userId;
          return (
            <li key={chat.id} className="space-y-1 rounded-lg border p-4">
              <p className="font-medium">{nameOf.get(otherId) ?? "Someone"}</p>
              <p className="text-muted-foreground text-sm">
                {chat.status === "kept"
                  ? "Kept chat"
                  : youWriteFirst
                    ? "You write first."
                    : "They write first."}
              </p>
              {theirNote.get(chat.id) && (
                <p className="bg-muted rounded-md p-2 text-sm">
                  Their note: {theirNote.get(chat.id)}
                </p>
              )}
              {chat.status === "open" && (
                <p className="text-sm">
                  Time left:{" "}
                  <Countdown
                    target={chat.window_ends_at}
                    renderedAt={renderedAt}
                  />
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground text-sm">
        Messaging is not switched on yet. It is the next thing I am building.
      </p>
    </section>
  );
}
