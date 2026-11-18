import Link from "next/link";
import { redirect } from "next/navigation";
import { Countdown } from "@/components/shortlist/countdown";
import { CONVERSATION_CONFIG } from "@/config/conversation";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import type { Conv } from "@/lib/conversation/state";
import {
  listBadge,
  previewText,
  type ListBadge,
} from "@/lib/conversation/view";
import { logEvent } from "@/lib/events";
import { homeRedirect } from "@/lib/onboarding";
import { requireUserProfile } from "@/lib/profile";
import { capStatusText, chatCap } from "@/lib/shortlist/caps";
import { retryWaitingChats } from "@/lib/shortlist/service";
import { createAdminClient } from "@/lib/supabase/admin";

// Reads the session and the clock, so it must never be prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "Chats | Shortlist" };

type Row = {
  id: string;
  user_a: string;
  user_b: string;
  opener_id: string;
  status: "open" | "kept" | "closed" | "expired" | "blocked";
  opened_at: string;
  window_ends_at: string;
};

type Summary = {
  conversation_id: string;
  last_body: string | null;
  last_sender: string | null;
  last_at: string | null;
  unread: number;
  i_sent: number;
  they_sent: number;
};

const BADGE_CLASS: Record<ListBadge["tone"], string> = {
  action: "bg-primary text-primary-foreground",
  waiting: "bg-muted text-foreground",
  calm: "bg-muted text-foreground",
  ended: "text-muted-foreground border",
};

// Your chats: the ones that are open or kept (they count toward the cap) and
// the ones that ended recently. Unread markers are your own: the other person
// never learns whether or when you read their message.
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

  const cutoff = new Date(
    now.getTime() - CONVERSATION_CONFIG.endedChatsVisibleDays * 86_400_000,
  ).toISOString();
  const load = async () => {
    const { data } = await supabase
      .from("conversations")
      .select(
        "id, user_a, user_b, opener_id, status, opened_at, window_ends_at",
      )
      .or(`status.in.(open,kept),opened_at.gte.${cutoff}`)
      .order("opened_at", { ascending: false });
    return (data ?? []) as Row[];
  };
  const isLive = (c: Row) => c.status === "open" || c.status === "kept";

  let chats = await load();
  // A match that was waiting for a free slot gets another try.
  const service = createAdminClient();
  if (service && !profile.paused && chats.filter(isLive).length < cap) {
    const opened = await retryWaitingChats(service, userId, cap, now);
    await Promise.all(
      opened.map(() =>
        logEvent("conversation_opened", userId, { source: "retry" }),
      ),
    );
    if (opened.length > 0) chats = await load();
  }

  const { data: summaryRows } = await supabase.rpc("my_conversation_summaries");
  const summaryOf = new Map(
    ((summaryRows ?? []) as Summary[]).map((s) => [s.conversation_id, s]),
  );

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

  const live = chats.filter(isLive);
  const ended = chats.filter((c) => !isLive(c));
  const renderedAt = now.toISOString();

  const renderChat = (chat: Row) => {
    const otherId = chat.user_a === userId ? chat.user_b : chat.user_a;
    const summary = summaryOf.get(chat.id);
    const conv: Conv = {
      status: chat.status,
      userA: userId,
      userB: otherId,
      openerId: chat.opener_id,
      openedAt: new Date(chat.opened_at),
      windowEndsAt: new Date(chat.window_ends_at),
      sentA: summary?.i_sent ?? 0,
      sentB: summary?.they_sent ?? 0,
      aDecision: null,
      bDecision: null,
      closedReason: null,
      closedBy: null,
    };
    const badge = listBadge(conv, userId, now);
    const name = nameOf.get(otherId) ?? "Someone";
    const unread = summary?.unread ?? 0;
    const lastMine = summary?.last_sender === userId;
    return (
      <li key={chat.id}>
        <Link
          href={`/chat/${chat.id}`}
          className="hover:bg-muted/50 block space-y-1 rounded-lg border p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              {name}
              {unread > 0 && (
                <span className="bg-primary text-primary-foreground rounded-full px-2 text-xs">
                  {unread} new
                  <span className="sr-only"> unread messages</span>
                </span>
              )}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${BADGE_CLASS[badge.tone]}`}
            >
              {badge.label}
            </span>
          </div>
          {summary?.last_body ? (
            <p className="text-muted-foreground truncate text-sm">
              {lastMine ? "You: " : ""}
              {previewText(summary.last_body)}
            </p>
          ) : (
            isLive(chat) && (
              <p className="text-muted-foreground text-sm">No messages yet.</p>
            )
          )}
          {chat.status === "open" && (
            <p className="text-muted-foreground text-xs">
              Time left:{" "}
              <Countdown target={chat.window_ends_at} renderedAt={renderedAt} />
            </p>
          )}
        </Link>
      </li>
    );
  };

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Chats</h1>
          <Link href="/shortlist" className="text-sm underline">
            Shortlist
          </Link>
        </div>
        <p className="text-sm">{capStatusText(live.length, cap)}</p>
        <p className="text-muted-foreground text-sm">
          You can have {cap} chats open at once. Each new chat has{" "}
          {SHORTLIST_CONFIG.windowHours} hours for you both to write; on day 3
          you each choose to keep talking or close kindly. Kept chats stay open
          and keep using a slot.
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

      {live.length > 0 && (
        <ul className="space-y-3" aria-label="Open chats">
          {live.map(renderChat)}
        </ul>
      )}

      {ended.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">
            Ended in the last {CONVERSATION_CONFIG.endedChatsVisibleDays} days
          </h2>
          <ul className="space-y-3" aria-label="Ended chats">
            {ended.map(renderChat)}
          </ul>
        </div>
      )}
    </section>
  );
}
