import Link from "next/link";
import { redirect } from "next/navigation";
import { BasicsForm } from "@/components/onboarding/basics-form";
import { InterestsForm } from "@/components/onboarding/interests-form";
import { PhotoManager } from "@/components/onboarding/photo-manager";
import { PromptsForm } from "@/components/onboarding/prompts-form";
import { ValuesForm } from "@/components/onboarding/values-form";
import { PauseToggle } from "@/components/profile/pause-toggle";
import { ProfileCard } from "@/components/profile/profile-card";
import { VerificationCard } from "@/components/profile/verification-card";
import { requireUserProfile, signedPhotos } from "@/lib/profile";
import type { StoredPrompt } from "@/lib/validators/profile";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your profile | Shortlist" };

function Section({
  title,
  children,
  open,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="rounded-lg border p-4">
      <summary className="cursor-pointer text-base font-medium">
        {title}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export default async function ProfilePage() {
  const { supabase, userId, profile, state } = await requireUserProfile();
  if (!state.complete) redirect("/onboarding");

  const photos = await signedPhotos(supabase, profile.photos ?? []);
  const { data: age } = await supabase.rpc("profile_age", { target: userId });

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <Link href="/home" className="text-sm underline">
          Back
        </Link>
      </div>

      <div className="space-y-2">
        <h2 className="text-muted-foreground text-sm">
          This is how others see you
        </h2>
        <ProfileCard
          profile={{
            displayName: profile.display_name,
            age: typeof age === "number" ? age : null,
            city: profile.city,
            intent: profile.intent,
            batchYear: profile.batch_year,
            occupation: profile.occupation,
            collegeTier: profile.college_tier,
            elitmusVerified: profile.elitmus_status === "verified",
            prompts: (profile.bio_prompts ?? []) as StoredPrompt[],
            interests: profile.interests ?? [],
            photoUrls: photos.map((p) => p.url),
          }}
        />
      </div>

      <Section title="Pause my profile" open>
        <PauseToggle paused={profile.paused} />
      </Section>
      <Section title="Verify with eLitmus (demo)">
        <VerificationCard status={profile.elitmus_status} />
      </Section>
      <Section title="Photos">
        <PhotoManager userId={userId} initialPhotos={photos} />
      </Section>
      <Section title="About you">
        <BasicsForm profile={profile} label="Save" />
      </Section>
      <Section title="Values questions">
        <ValuesForm profile={profile} label="Save" />
      </Section>
      <Section title="Prompts">
        <PromptsForm profile={profile} label="Save" />
      </Section>
      <Section title="Interests">
        <InterestsForm profile={profile} label="Save" />
      </Section>
    </section>
  );
}
