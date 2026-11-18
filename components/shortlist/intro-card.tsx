import Link from "next/link";
import { Sparkles } from "lucide-react";
import { IntroActions } from "@/components/shortlist/intro-actions";
import {
  ProfileCard,
  type ProfileCardData,
} from "@/components/profile/profile-card";
import { Countdown } from "@/components/shortlist/countdown";

// One intro: the person's card, why we matched you, and what you can do.
// What it says about a decided intro is deliberately neutral: it shows only
// YOUR own answer, never anything about the other person's.
export function IntroCard({
  introId,
  status,
  profile,
  reasons,
  myNote,
  chatId,
  atCap,
  capText,
  expiresAt,
  renderedAt,
}: {
  introId: string;
  status: "new" | "passed" | "interested" | "expired";
  profile: ProfileCardData;
  reasons: string[];
  myNote: string | null;
  chatId: string | null; // set when a chat with this person is open
  atCap: boolean;
  capText: string;
  expiresAt: string;
  renderedAt: string;
}) {
  return (
    <li className="space-y-3">
      <ProfileCard profile={profile} />

      {reasons.length > 0 && (
        <section
          aria-label={`Why we matched you with ${profile.displayName}`}
          className="bg-muted/60 space-y-1 rounded-lg p-4"
        >
          <h3 className="flex items-center gap-1 text-sm font-medium">
            <Sparkles className="size-4" aria-hidden />
            Why we matched you
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-3 rounded-lg border p-4">
        {status === "new" && (
          <p className="text-muted-foreground text-xs">
            Answer within{" "}
            <Countdown target={expiresAt} renderedAt={renderedAt} />, when the
            next drop arrives.
          </p>
        )}

        {chatId ? (
          <p className="text-sm">
            You have a chat open with {profile.displayName}.{" "}
            <Link href="/chat" className="underline">
              Go to Chats
            </Link>
          </p>
        ) : status === "interested" ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">You said you are interested.</p>
            <p className="text-muted-foreground">
              If it is mutual, a chat opens and shows up under Chats. Until then
              we do not say anything about what they decided.
            </p>
            {myNote && (
              <p className="text-muted-foreground">Your note: {myNote}</p>
            )}
          </div>
        ) : status === "passed" ? (
          <p className="text-muted-foreground text-sm">
            You passed. They are not told.
          </p>
        ) : status === "expired" ? (
          <p className="text-muted-foreground text-sm">This intro expired.</p>
        ) : null}

        <IntroActions
          introId={introId}
          status={chatId ? "interested" : status}
          atCap={atCap}
          capText={capText}
        />
      </div>
    </li>
  );
}
