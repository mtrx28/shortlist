import { BadgeCheck } from "lucide-react";
import { COLLEGE_TIERS, INTENTS } from "@/config/profile-options";
import { PROMPTS } from "@/config/prompts";

// How a profile looks to other people. It only shows what we decided to share:
// no date of birth (just the age), no pH score, no exact location. The
// Shortlist screen will reuse this card.
export type ProfileCardData = {
  displayName: string;
  age?: number | null;
  city?: string | null;
  intent?: string | null;
  batchYear?: number | null;
  occupation?: string | null;
  collegeTier?: string | null;
  elitmusVerified: boolean; // true only when elitmus_status is "verified"
  prompts: { id: string; answer: string }[];
  interests: string[];
  photoUrls: string[];
};

export function ProfileCard({ profile }: { profile: ProfileCardData }) {
  const intent = INTENTS.find((i) => i.value === profile.intent)?.label;
  const tier = COLLEGE_TIERS.find(
    (t) => t.value === profile.collegeTier && t.value !== "prefer_not_to_say",
  )?.label;
  const [mainPhoto, ...otherPhotos] = profile.photoUrls;

  return (
    <article className="bg-card overflow-hidden rounded-lg border">
      {mainPhoto ? (
        // Plain img: short-lived signed links, not static assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mainPhoto}
          alt={`${profile.displayName}'s photo`}
          className="aspect-[3/4] w-full object-cover"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex aspect-[3/4] items-center justify-center text-sm">
          No photo yet
        </div>
      )}

      <div className="space-y-4 p-4">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold">
            {profile.displayName}
            {profile.age ? `, ${profile.age}` : ""}
          </h2>
          {profile.elitmusVerified && (
            <p className="flex items-center gap-1 text-sm font-medium">
              <BadgeCheck className="size-4" aria-hidden />
              Verified via eLitmus (demo)
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            {[
              profile.occupation,
              profile.city,
              profile.batchYear ? `pH batch ${profile.batchYear}` : null,
              tier ? `${tier} college` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {intent && <p className="text-sm">Looking for: {intent}</p>}
        </header>

        {profile.prompts.map((p) => (
          <section key={p.id} className="space-y-1">
            <h3 className="text-muted-foreground text-xs">
              {PROMPTS.find((x) => x.id === p.id)?.text ?? ""}
            </h3>
            <p className="text-sm">{p.answer}</p>
          </section>
        ))}

        {profile.interests.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {profile.interests.map((i) => (
              <li key={i} className="bg-muted rounded-full px-3 py-1 text-xs">
                {i}
              </li>
            ))}
          </ul>
        )}

        {otherPhotos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {otherPhotos.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                className="aspect-square w-full rounded-md object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
