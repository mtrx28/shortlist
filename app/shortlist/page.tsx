import Link from "next/link";
import { redirect } from "next/navigation";
import { Countdown } from "@/components/shortlist/countdown";
import { IntroCard } from "@/components/shortlist/intro-card";
import { SecondLook } from "@/components/shortlist/second-look";
import { SECOND_LOOK } from "@/config/plans";
import { loadMatchDetails } from "@/lib/matching/detail-service";
import { entitlements } from "@/lib/plus";
import { logEvent } from "@/lib/events";
import { homeRedirect } from "@/lib/onboarding";
import { requireUserProfile, signedPhotos } from "@/lib/profile";
import { capStatusText, isAtCap } from "@/lib/shortlist/caps";
import type { IntroStatus } from "@/lib/shortlist/decide";
import { retryWaitingChats } from "@/lib/shortlist/service";
import { nextDropAt } from "@/lib/shortlist/time";
import { buildShortlistView } from "@/lib/shortlist/view";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StoredPrompt } from "@/lib/validators/profile";

// Reads the session and the clock, so it must never be prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "Your shortlist | Shortlist" };

type MyIntro = {
  id: string;
  candidate_id: string;
  reasons: string[];
  status: IntroStatus;
  note: string | null;
  first_view: boolean;
};

type Candidate = {
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

export default async function ShortlistPage() {
  const { supabase, userId, profile, state } = await requireUserProfile();
  const away = homeRedirect(state);
  if (away) redirect(away);

  const now = new Date();
  const service = createAdminClient();

  // Chats that are open now count toward the cap.
  const { data: chats } = await supabase
    .from("conversations")
    .select("id, user_a, user_b")
    .in("status", ["open", "kept"]);
  const { data: plus } = await supabase
    .from("profiles")
    .select("plus_until")
    .eq("id", userId)
    .maybeSingle();
  const rights = entitlements((plus?.plus_until as string | null) ?? null, now);
  const cap = rights.chatCap;

  // A match that was waiting for a free slot gets another try.
  let liveChats = chats ?? [];
  if (service && !profile.paused && liveChats.length < cap) {
    const opened = await retryWaitingChats(service, userId, cap, now);
    await Promise.all(
      opened.map(() =>
        logEvent("conversation_opened", userId, { source: "retry" }),
      ),
    );
    if (opened.length > 0) {
      const { data: again } = await supabase
        .from("conversations")
        .select("id, user_a, user_b")
        .in("status", ["open", "kept"]);
      liveChats = again ?? [];
    }
  }
  const openChats = liveChats.length;
  const atCap = isAtCap(openChats, cap);
  const capText = capStatusText(openChats, cap);
  const chatWith = new Map<string, string>();
  for (const c of liveChats) {
    chatWith.set(c.user_a === userId ? c.user_b : c.user_a, c.id);
  }

  // My intros for the latest drop. Only my own rows come back.
  const { data: raw } = await supabase.rpc("my_shortlist");
  const list = (raw ?? { week_start: null, intros: [] }) as {
    week_start: string | null;
    intros: MyIntro[];
  };

  const view = buildShortlistView({
    paused: profile.paused,
    latestWeek: list.week_start,
    statuses: list.intros.map((i) => i.status),
    now,
  });

  for (const intro of list.intros) {
    if (intro.first_view) await logEvent("intro_viewed", userId);
  }

  // Second look (a Plus perk): intros brought back, and ones that could be.
  type Eligible = {
    id: string;
    candidate_id: string;
    week_start: string;
    status: string;
  };
  type Revived = MyIntro & { revived_until: string };
  const { data: secondRaw } = await supabase.rpc("my_second_looks", {
    p_lookback_days: SECOND_LOOK.lookbackDays,
  });
  const second = (secondRaw ?? {
    used_at: null,
    eligible: [],
    revived: [],
  }) as {
    used_at: string | null;
    eligible: Eligible[];
    revived: Revived[];
  };
  // A brought-back intro from the current week is already in the main list.
  const mainIds = new Set(list.intros.map((i) => i.id));
  const revived = second.revived.filter((r) => !mainIds.has(r.id));

  const showCards = view.screen === "intros" || view.screen === "all_decided";
  const shown = [...(showCards ? list.intros : []), ...revived];
  let cards: React.ReactNode = null;
  let revivedCards: React.ReactNode = null;
  let eligibleList: {
    id: string;
    name: string;
    city: string | null;
    week: string;
  }[] = [];
  if (shown.length > 0 || second.eligible.length > 0) {
    const ids = [
      ...new Set([
        ...shown.map((i) => i.candidate_id),
        ...second.eligible.map((e) => e.candidate_id),
      ]),
    ];
    const { data: people } = await supabase
      .from("profiles")
      .select(
        "id, display_name, city, intent, batch_year, occupation, college_tier, elitmus_status, bio_prompts, interests, photos",
      )
      .in("id", ids);
    const byId = new Map(((people ?? []) as Candidate[]).map((p) => [p.id, p]));
    const photos = await signedPhotos(
      supabase,
      [...byId.values()].flatMap((p) => p.photos ?? []),
    );
    const urlOf = new Map(photos.map((p) => [p.path, p.url]));
    const ages = new Map<string, number | null>();
    await Promise.all(
      ids.map(async (id) => {
        const { data } = await supabase.rpc("profile_age", { target: id });
        ages.set(id, typeof data === "number" ? data : null);
      }),
    );
    // The Plus breakdown, built on the server from both people answers.
    const details =
      rights.reasonsDetail && service
        ? await loadMatchDetails(
            service,
            userId,
            shown.map((i) => i.candidate_id),
            now,
          )
        : new Map();

    eligibleList = second.eligible.flatMap((e) => {
      const p = byId.get(e.candidate_id);
      return p
        ? [{ id: e.id, name: p.display_name, city: p.city, week: e.week_start }]
        : [];
    });

    const renderedAt = now.toISOString();
    const card = (intro: MyIntro, expiresAt: string, isSecond: boolean) => {
      const person = byId.get(intro.candidate_id);
      // Someone who was blocked, suspended or deleted since the drop
      // is no longer readable, so their card is left out.
      if (!person) return null;
      return (
        <IntroCard
          key={intro.id}
          introId={intro.id}
          candidateId={person.id}
          status={intro.status}
          reasons={intro.reasons}
          myNote={intro.note}
          chatId={chatWith.get(person.id) ?? null}
          atCap={atCap}
          capText={capText}
          expiresAt={expiresAt}
          renderedAt={renderedAt}
          detail={details.get(person.id) ?? null}
          showPlusHint={!rights.isPlus}
          secondLook={isSecond}
          profile={{
            displayName: person.display_name,
            age: ages.get(person.id) ?? null,
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
      );
    };

    if (showCards) {
      const expiresAt = view.expiresAt ? view.expiresAt.toISOString() : "";
      cards = (
        <ul className="space-y-10">
          {list.intros.map((intro) => card(intro, expiresAt, false))}
        </ul>
      );
    }
    if (revived.length > 0) {
      revivedCards = (
        <ul className="space-y-10">
          {revived.map((intro) =>
            card(intro, new Date(intro.revived_until).toISOString(), true),
          )}
        </ul>
      );
    }
  }

  const nextDrop = nextDropAt(now);
  const renderedAt = now.toISOString();

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Your shortlist
          </h1>
          <Link href="/home" className="text-sm underline">
            Back
          </Link>
        </div>
        <p className="text-muted-foreground text-sm">
          Next drop in{" "}
          <Countdown target={nextDrop.toISOString()} renderedAt={renderedAt} />{" "}
          (Sunday, 8 pm India time).
        </p>
        <p className="text-sm">
          <Link href="/chat" className="underline">
            Chats
          </Link>
          : {capText}
        </p>
        {view.screen === "intros" && (
          <p className="text-sm font-medium">
            {view.left} of {view.total} left to answer this week
          </p>
        )}
      </div>

      {atCap && view.screen === "intros" && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          You have {capText}, the most you can have at once. You can pass on
          intros, but to say Interested you first need to finish or close a
          chat. Intros stay here until the next drop. Plus members can have more
          chats open.
        </p>
      )}

      {view.screen === "paused" && (
        <Empty title="Your profile is paused">
          You are not in anyone&apos;s shortlist and cannot answer intros while
          it is paused. Nothing is deleted.{" "}
          <Link href="/account/profile" className="underline">
            Unpause your profile
          </Link>{" "}
          to take part in the next drop.
        </Empty>
      )}
      {view.screen === "no_drop" && (
        <Empty title="No drop yet">
          The first shortlists have not gone out yet. Every Sunday evening we
          pick a few people for you, and they show up here. Fewer, better
          introductions is the whole idea.
        </Empty>
      )}
      {view.screen === "between_drops" && (
        <Empty title="This week's intros have ended">
          Last week&apos;s intros expired when the new week began. The next drop
          arrives in{" "}
          <Countdown target={nextDrop.toISOString()} renderedAt={renderedAt} />.
        </Empty>
      )}
      {view.screen === "no_intros" && (
        <Empty title="Nothing for you this week">
          We would rather show you nobody than the wrong people. We only
          introduce people in your city who fit what you are both looking for,
          and there was nobody this week. Pools grow as more people join; the
          next drop is on Sunday.
        </Empty>
      )}
      {view.screen === "all_decided" && (
        <Empty title="You have answered everything">
          That is this week done. Chats that open appear under{" "}
          <Link href="/chat" className="underline">
            Chats
          </Link>
          . The next drop arrives in{" "}
          <Countdown target={nextDrop.toISOString()} renderedAt={renderedAt} />.
        </Empty>
      )}

      {cards}

      {revivedCards && (
        <section aria-label="Brought back by second look" className="space-y-6">
          <h2 className="text-base font-medium">Your second look</h2>
          {revivedCards}
        </section>
      )}

      <SecondLook
        isPlus={rights.isPlus}
        usedAt={second.used_at}
        perDays={SECOND_LOOK.perDays}
        revivedHours={SECOND_LOOK.revivedHours}
        options={eligibleList}
        now={now.toISOString()}
      />
    </section>
  );
}

function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}
