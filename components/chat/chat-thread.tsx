"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendMessageAction } from "@/app/chat/[id]/actions";
import { DecisionPanel } from "@/components/chat/decision-panel";
import { DemoPanel } from "@/components/chat/demo-panel";
import { Button } from "@/components/ui/button";
import { CONVERSATION_CONFIG, SAFE_MEET_TIPS } from "@/config/conversation";
import { contactWarningFor } from "@/lib/conversation/message";
import {
  addIncoming,
  addIncomingMany,
  addPending,
  confirmPending,
  failPending,
  newestSentAt,
  removePending,
  retryPending,
  type ChatMessage,
} from "@/lib/conversation/thread-state";
import { threadView, type ConversationSnapshot } from "@/lib/conversation/view";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { formatTimeLeft } from "@/lib/shortlist/time";
import {
  CONTACT_MESSAGES,
  type ContactKind,
} from "@/lib/validators/contact-info";

// The chat screen. Messages arrive in three ways, and all three go through
// the same "add if not already there" function, so a message can never show
// twice:
//   1. Supabase Realtime (a live subscription, filtered to this chat). Row
//      level security decides who gets the events: only the two people.
//   2. Polling. If realtime is not connected the browser asks for new
//      messages every few seconds; when it is connected it still checks every
//      20 seconds as a safety net, and once straight after (re)connecting so
//      nothing sent while it was offline is missed.
//   3. Your own sends, shown at once ("optimistic") and then confirmed by the
//      server's reply.
// I could not test realtime from the build environment, so the polling path
// is what keeps the screen correct if the live connection never comes up.

type Row = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

const toMessage = (r: Row): Omit<ChatMessage, "status"> => ({
  id: r.id,
  senderId: r.sender_id,
  body: r.body,
  createdAt: r.created_at,
});

const MESSAGE_COLUMNS = "id, sender_id, body, created_at";

export function ChatThread({
  conversationId,
  meId,
  otherName,
  initialMessages,
  initialSnapshot,
  introNote,
  showDemoPanel,
}: {
  conversationId: string;
  meId: string;
  otherName: string;
  initialMessages: ChatMessage[];
  initialSnapshot: ConversationSnapshot;
  introNote: string | null;
  showDemoPanel: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [snap, setSnap] = useState<ConversationSnapshot>(initialSnapshot);
  const [now, setNow] = useState(() => new Date(initialSnapshot.server_now));
  const [realtimeUp, setRealtimeUp] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    body: string;
    kind: ContactKind;
  } | null>(null);

  const supabase = useMemo(() => createBrowserSupabase(), []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // How far the server's clock is ahead of this device's clock.
  const skewRef = useRef(
    new Date(initialSnapshot.server_now).getTime() - Date.now(),
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const lastMarkedRef = useRef<string | null>(null);

  const view = threadView(snap, meId, now);

  // ---- read the chat's state (status, decision, counts) ----
  const refreshSnapshot = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.rpc("get_conversation", {
      p_conversation: conversationId,
    });
    if (data) {
      const next = data as ConversationSnapshot;
      skewRef.current = new Date(next.server_now).getTime() - Date.now();
      setSnap(next);
      setNow(new Date(next.server_now));
    }
  }, [supabase, conversationId]);

  // ---- fetch anything newer than what we have ----
  const catchUp = useCallback(async () => {
    if (!supabase) return;
    const since = newestSentAt(messagesRef.current);
    let query = supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);
    // ">=" so two messages with the same timestamp are not skipped; the
    // duplicate is dropped by id.
    if (since) query = query.gte("created_at", since);
    const { data } = await query;
    if (data && data.length > 0) {
      setMessages((list) =>
        addIncomingMany(list, (data as Row[]).map(toMessage)),
      );
    }
    await refreshSnapshot();
  }, [supabase, conversationId, refreshSnapshot]);

  // ---- realtime subscription ----
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      // Make sure the live connection uses the signed-in person's token, so
      // row level security sees who is listening.
      const { data: session } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session.session) {
        supabase.realtime.setAuth(session.session.access_token);
      }
      const channel = supabase
        .channel(`chat:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const row = payload.new as Row;
            if (!row?.id) return;
            setMessages((list) => addIncoming(list, toMessage(row)));
            // A new message can change what the screen allows (for example
            // the first reply starts the decision stage), so re-read the state.
            void refreshSnapshot();
          },
        )
        .subscribe((status) => {
          const up = status === "SUBSCRIBED";
          setRealtimeUp(up);
          // After (re)connecting, fetch what was missed while offline.
          if (up) void catchUp();
        });
      cleanup = () => {
        void supabase.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [supabase, conversationId, catchUp, refreshSnapshot]);

  // ---- polling: fast when realtime is down, a slow safety net when up ----
  useEffect(() => {
    const ms = realtimeUp
      ? CONVERSATION_CONFIG.pollSlowMs
      : CONVERSATION_CONFIG.pollFastMs;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void catchUp();
    }, ms);
    return () => clearInterval(timer);
  }, [realtimeUp, catchUp]);

  // ---- the clock for countdowns, corrected to the server's time ----
  useEffect(() => {
    const timer = setInterval(
      () => setNow(new Date(Date.now() + skewRef.current)),
      15_000,
    );
    return () => clearInterval(timer);
  }, []);

  // ---- keep the view scrolled to the newest message (if you were there) ----
  useEffect(() => {
    const onScroll = () => {
      nearBottomRef.current =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length]);

  // ---- mark as read when the newest message is from them and the tab is visible ----
  useEffect(() => {
    if (!supabase) return;
    const newest = newestSentAt(messages);
    if (!newest || lastMarkedRef.current === newest) return;
    if (document.visibilityState !== "visible") return;
    lastMarkedRef.current = newest;
    void supabase.rpc("mark_conversation_read", {
      p_conversation: conversationId,
    });
  }, [messages, supabase, conversationId]);

  // Coming back to the tab counts as reading what arrived meanwhile.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void catchUp();
        void supabase?.rpc("mark_conversation_read", {
          p_conversation: conversationId,
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [catchUp, supabase, conversationId]);

  // ---- sending ----
  const deliver = useCallback(
    async (clientId: string, body: string, confirmContact: boolean) => {
      let result: Awaited<ReturnType<typeof sendMessageAction>>;
      try {
        result = await sendMessageAction({
          conversationId,
          body,
          confirmContact,
        });
      } catch {
        // The request itself failed (offline, server down): keep it, let the
        // person retry.
        setMessages((list) => failPending(list, clientId));
        return;
      }

      if (result.ok) {
        setMessages((list) =>
          confirmPending(list, clientId, {
            id: result.id,
            createdAt: result.createdAt,
          }),
        );
        void refreshSnapshot();
        return;
      }
      if (result.code === "confirm_contact" && result.needsConfirm) {
        // The server wants the "are you sure" step. Take the message back out
        // of the list and ask.
        setMessages((list) => removePending(list, clientId));
        setConfirm({ body, kind: result.needsConfirm });
        return;
      }
      if (result.code === "failed" || result.code === "not_ready") {
        setMessages((list) => failPending(list, clientId));
        setError(result.message);
        return;
      }
      // A clear "no" (rate limit, not your turn, window over...): take the
      // message back out, put the text back so nothing is lost, say why.
      setMessages((list) => removePending(list, clientId));
      setDraft((current) => (current ? current : body));
      setError(result.message);
      void refreshSnapshot();
    },
    [conversationId, refreshSnapshot],
  );

  const send = useCallback(
    (body: string, confirmContact: boolean) => {
      const clientId = `local-${crypto.randomUUID()}`;
      setError(null);
      setMessages((list) => addPending(list, clientId, meId, body, new Date()));
      void deliver(clientId, body, confirmContact);
    },
    [deliver, meId],
  );

  function onSubmit() {
    const body = draft.trim();
    if (!body || !view.canCompose) return;
    setError(null);
    // First message from me in this chat? Warn softly about contact details.
    const isFirst =
      snap.i_sent === 0 &&
      !messages.some((m) => m.senderId === meId && m.status !== "failed");
    const kind = contactWarningFor(body, isFirst);
    if (kind) {
      setConfirm({ body, kind });
      return;
    }
    setDraft("");
    send(body, false);
    textareaRef.current?.focus();
  }

  function confirmSend() {
    if (!confirm) return;
    const { body } = confirm;
    setConfirm(null);
    setDraft("");
    send(body, true);
    textareaRef.current?.focus();
  }

  function editInstead() {
    if (confirm) setDraft(confirm.body);
    setConfirm(null);
    textareaRef.current?.focus();
  }

  async function retry(clientId: string, body: string) {
    // The first try may have worked even though the answer never arrived. Look
    // for it before sending again.
    await catchUp();
    const already = messagesRef.current.some(
      (m) => m.status === "sent" && m.senderId === meId && m.body === body,
    );
    if (already) {
      setMessages((list) => removePending(list, clientId));
      return;
    }
    setMessages((list) => retryPending(list, clientId));
    void deliver(clientId, body, true);
  }

  const timeLeft = formatTimeLeft(view.windowEndsAt, now);
  const decisionIn = formatTimeLeft(view.decisionOpensAt, now);

  return (
    <div className="space-y-4">
      {/* State of the chat: whose turn it is, and the time left. */}
      <StatusStrip
        view={view}
        otherName={otherName}
        timeLeft={timeLeft}
        decisionIn={decisionIn}
        snap={snap}
        meId={meId}
      />

      {view.nudge && (
        <div
          role="status"
          className="bg-muted space-y-1 rounded-lg border p-3 text-sm"
        >
          <p className="font-medium">A gentle reminder</p>
          <p>
            {view.iAmOpener
              ? `You have not written to ${otherName} yet.`
              : `${otherName} wrote to you and is waiting for a reply.`}{" "}
            This chat ends in about {view.nudge.hoursLeft} hour
            {view.nudge.hoursLeft === 1 ? "" : "s"} if it goes quiet, and that
            counts toward your reply rate. If you are not interested, you do not
            have to do anything.
          </p>
        </div>
      )}

      {view.showDecision && (
        <DecisionPanel
          conversationId={conversationId}
          otherName={otherName}
          myDecision={view.myDecision}
          onDone={() => void refreshSnapshot()}
        />
      )}

      {introNote && (
        <p className="bg-muted rounded-md p-3 text-sm">
          <span className="text-muted-foreground">Their note: </span>
          {introNote}
        </p>
      )}

      {/* The messages. role="log" + aria-live make a screen reader read new ones. */}
      <div
        role="log"
        aria-live="polite"
        aria-label={`Messages with ${otherName}`}
        className="space-y-2"
      >
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm">No messages yet.</p>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.senderId === meId}
            onRetry={() => void retry(m.id, m.body)}
            onRemove={() => setMessages((l) => removePending(l, m.id))}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {!realtimeUp && supabase && (
        <p className="text-muted-foreground text-xs">
          Live updates are reconnecting. New messages still arrive every few
          seconds.
        </p>
      )}

      {view.phase === "kept" && (
        <section
          aria-label="Safe meeting tips"
          className="bg-muted/60 space-y-1 rounded-lg p-3 text-sm"
        >
          <h2 className="font-medium">Before you meet</h2>
          <ul className="list-disc space-y-1 pl-5">
            {SAFE_MEET_TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      )}

      {confirm && (
        <div
          role="alertdialog"
          aria-labelledby="confirm-heading"
          className="space-y-2 rounded-lg border-2 p-3 text-sm"
        >
          <h2 id="confirm-heading" className="font-medium">
            Are you sure? Keep early chats in the app.
          </h2>
          <p>
            {CONTACT_MESSAGES[confirm.kind]} People you have only just met are
            safer to talk to here, where you can report or block them. If you
            send it anyway, the message is marked for review by our team.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={editInstead}>
              Edit my message
            </Button>
            <Button type="button" onClick={confirmSend}>
              Send anyway
            </Button>
          </div>
        </div>
      )}

      {/* The composer, or the reason there is none. */}
      {view.canCompose ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-2"
        >
          <label htmlFor="message" className="sr-only">
            Message to {otherName}
          </label>
          <textarea
            id="message"
            ref={textareaRef}
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter makes a new line.
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={
              messages.length === 0
                ? `Say hello to ${otherName}`
                : "Write a message"
            }
            className="border-input bg-background w-full rounded-lg border p-3 text-sm"
            aria-describedby="message-help"
          />
          <div className="flex items-center justify-between gap-3">
            <p id="message-help" className="text-muted-foreground text-xs">
              Enter sends, Shift+Enter adds a line.
              {draft.length > CONVERSATION_CONFIG.messageMaxLength * 0.8 &&
                ` ${draft.length} / ${CONVERSATION_CONFIG.messageMaxLength}`}
            </p>
            <Button
              type="submit"
              disabled={
                draft.trim().length === 0 ||
                draft.length > CONVERSATION_CONFIG.messageMaxLength
              }
            >
              Send
            </Button>
          </div>
        </form>
      ) : (
        view.composeOffReason && (
          <p className="bg-muted rounded-md p-3 text-sm">
            {view.composeOffReason}
          </p>
        )
      )}

      <div aria-live="assertive">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      {showDemoPanel && (
        <DemoPanel
          conversationId={conversationId}
          onDone={() => void refreshSnapshot()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatusStrip({
  view,
  otherName,
  timeLeft,
  decisionIn,
  snap,
  meId,
}: {
  view: ReturnType<typeof threadView>;
  otherName: string;
  timeLeft: string;
  decisionIn: string;
  snap: ConversationSnapshot;
  meId: string;
}) {
  let title = "";
  let text = "";
  switch (view.phase) {
    case "awaiting_opener":
      title = view.iAmOpener ? "Your turn" : "Waiting for them to write";
      text = view.iAmOpener
        ? `You write first in this chat. Say hello to ${otherName}; a question about something on their profile is a good start.`
        : `${otherName} writes first in this chat. You will see their message here.`;
      break;
    case "awaiting_reply":
      title = view.iAmOpener ? "Waiting for a reply" : "Your turn";
      text = view.iAmOpener
        ? `${otherName} has your message. You can write more once they reply.`
        : `${otherName} has written to you. Reply when you are ready.`;
      break;
    case "chatting":
      title = "You are both talking";
      text = `The choice to keep talking or close kindly opens in ${decisionIn} (day 3).`;
      break;
    case "deciding":
      title = "Time to decide";
      text = "You have both written. Choose below whether to keep talking.";
      break;
    case "kept":
      title = "Kept chat";
      text = `You both chose to keep talking. This chat has no time limit and uses one of your chat slots.`;
      break;
    case "closed":
      title = "This chat was closed kindly";
      text =
        snap.closed_by === meId
          ? "You closed this chat. The note you chose was shared with them."
          : snap.closed_reason
            ? `They closed it. Their note: "${snap.closed_reason}"`
            : "They closed this chat.";
      break;
    case "expired":
    case "timed_out":
      title = "This chat has ended";
      text =
        "The time ran out before the chat could continue. Nobody is blamed: it happens. You can no longer send messages here. A new drop brings new introductions every Sunday.";
      break;
  }

  return (
    <section
      aria-label="Chat status"
      className="space-y-1 rounded-lg border p-3 text-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {view.showWindowCountdown && (
          <p className="text-muted-foreground text-xs">Time left: {timeLeft}</p>
        )}
      </div>
      <p className="text-muted-foreground">{text}</p>
    </section>
  );
}

function MessageBubble({
  message,
  mine,
  onRetry,
  onRemove,
}: {
  message: ChatMessage;
  mine: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[85%] space-y-1 rounded-2xl px-3 py-2 text-sm " +
          (mine ? "bg-primary text-primary-foreground" : "bg-muted")
        }
      >
        <p className="break-words whitespace-pre-wrap">{message.body}</p>
        <p
          className={
            "text-xs " +
            (mine ? "text-primary-foreground/70" : "text-muted-foreground")
          }
        >
          {message.status === "sending" && "Sending..."}
          {message.status === "sent" && time}
          {message.status === "failed" && (
            <>
              Not sent.{" "}
              <button type="button" className="underline" onClick={onRetry}>
                Try again
              </button>{" "}
              <button type="button" className="underline" onClick={onRemove}>
                Remove
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
