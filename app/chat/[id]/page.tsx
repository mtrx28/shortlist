import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { ChatThread } from "@/components/chat/chat-thread";
import { ProfileCard } from "@/components/profile/profile-card";
import { demoControlsEnabled, demoGuard } from "@/lib/conversation/demo";
import type { ChatMessage } from "@/lib/conversation/thread-state";
import type { ConversationSnapshot } from "@/lib/conversation/view";
import { homeRedirect } from "@/lib/onboarding";
import { requireUserProfile, signedPhotos } from "@/lib/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StoredPrompt } from "@/lib/validators/profile";

// Reads the session and the clock, so it must never be prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "Chat | Shortlist" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Person = {
  id: string;
  display_name: string;
  city: string | null;
  intent: string | null;
  batch_year: number | null;
  occupation: string | null;
  college_tier: string | null;
  elitmus_status: string;
  bio_prompts: StoredPrompt[] | null;
  interests: string[] | null;
  photos: string[] | null;
};

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, userId, profile, state } = await requireUserProfile();
  const away = homeRedirect(state);
  if (away) redirect(away);
  if (!UUID.test(id)) notFound();

  // Row level security and get_conversation() both answer "nothing" for
  // someone who is not in this chat, so a stranger gets the same 404 as for a
  // chat that does not exist.
  const { data: raw } = await supabase.rpc("get_conversation", {
    p_conversation: id,
  });
  if (!raw) notFound();
  const snapshot = raw as ConversationSnapshot;

  // The other person's card. If it cannot be read (they were blocked,
  // suspended or deleted) the chat shows a neutral name.
  const { data: personRow } = await supabase
    .from("profiles")
    .select(
      "id, display_name, city, intent, batch_year, occupation, college_tier, elitmus_status, bio_prompts, interests, photos",
    )
    .eq("id", snapshot.other_id)
    .maybeSingle();
  const person = (personRow as Person | null) ?? null;
  const otherName = person?.display_name ?? "This person";

  const { data: ageData } = await supabase.rpc("profile_age", {
    target: snapshot.other_id,
  });
  const age = typeof ageData === "number" ? ageData : null;
  const photos = person
    ? await signedPhotos(supabase, person.photos ?? [])
    : [];
  const urlOf = new Map(photos.map((p) => [p.path, p.url]));

  // Messages, newest 200, read as the signed-in person (RLS applies).
  const { data: rows } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(200);
  const initialMessages: ChatMessage[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    senderId: r.sender_id as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    status: "sent",
  }));

  // The note they wrote with their Interested.
  const { data: notes } = await supabase.rpc("conversation_intro_notes", {
    p_conversation: id,
  });
  const introNote =
    ((notes ?? []) as { author_id: string; note: string }[]).find(
      (n) => n.author_id !== userId,
    )?.note ?? null;

  // Opening the chat counts as reading it. Only you can see this marker.
  await supabase.rpc("mark_conversation_read", { p_conversation: id });

  // Demo controls: only when the setting is on and a demo account is in the
  // chat. (The action checks again; this only decides whether to show them.)
  let showDemoPanel = false;
  if (demoControlsEnabled() && snapshot.status === "open") {
    const service = createAdminClient();
    if (service) {
      const demoAccounts: Record<string, boolean> = {};
      for (const uid of [userId, snapshot.other_id]) {
        const { data } = await service.auth.admin.getUserById(uid);
        demoAccounts[uid] = data.user?.app_metadata?.demo === true;
      }
      showDemoPanel = demoGuard({
        enabled: true,
        actorId: userId,
        actorIsAdmin: profile.role === "admin",
        userA: userId,
        userB: snapshot.other_id,
        demoAccounts,
      }).ok;
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <Link href="/chat" className="text-sm underline">
            All chats
          </Link>
          {/* M7 will turn this into the real safety menu (report and block).
              Until then it is a clearly marked placeholder that does nothing. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Report and block arrive in the next update"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm"
          >
            <ShieldAlert className="size-4" aria-hidden />
            Safety (coming soon)
          </button>
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {otherName}
            {age ? `, ${age}` : ""}
          </h1>
          {person && (
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
              {person.city && <span>{person.city}</span>}
              {person.elitmus_status === "verified" && (
                <span className="inline-flex items-center gap-1">
                  <BadgeCheck className="size-4" aria-hidden />
                  Verified via eLitmus (demo)
                </span>
              )}
            </p>
          )}
        </div>
        {person && (
          <details className="rounded-lg border">
            <summary className="cursor-pointer p-3 text-sm font-medium">
              See {person.display_name}&apos;s profile
            </summary>
            <div className="p-3 pt-0">
              <ProfileCard
                profile={{
                  displayName: person.display_name,
                  age,
                  city: person.city,
                  intent: person.intent,
                  batchYear: person.batch_year,
                  occupation: person.occupation,
                  collegeTier: person.college_tier,
                  elitmusVerified: person.elitmus_status === "verified",
                  prompts: person.bio_prompts ?? [],
                  interests: person.interests ?? [],
                  photoUrls: (person.photos ?? []).flatMap((p) => {
                    const url = urlOf.get(p);
                    return url ? [url] : [];
                  }),
                }}
              />
            </div>
          </details>
        )}
      </header>

      <ChatThread
        conversationId={id}
        meId={userId}
        otherName={otherName}
        initialMessages={initialMessages}
        initialSnapshot={snapshot}
        introNote={introNote}
        showDemoPanel={showDemoPanel}
      />
    </section>
  );
}
