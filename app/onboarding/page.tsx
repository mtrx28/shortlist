import Link from "next/link";
import { redirect } from "next/navigation";
import { BasicsForm } from "@/components/onboarding/basics-form";
import { FinishForm } from "@/components/onboarding/finish-form";
import { InterestsForm } from "@/components/onboarding/interests-form";
import { PhotoManager } from "@/components/onboarding/photo-manager";
import { PromptsForm } from "@/components/onboarding/prompts-form";
import { ValuesForm } from "@/components/onboarding/values-form";
import {
  nextStep,
  onboardingRedirect,
  STEP_TITLES,
  STEPS,
  stepToShow,
} from "@/lib/onboarding";
import { requireUserProfile, signedPhotos } from "@/lib/profile";

// Reads the session and the profile, so never prerender it.
export const dynamic = "force-dynamic";

export const metadata = { title: "Set up your profile | Shortlist" };

// The steps are shown one at a time at /onboarding?step=values etc. Where the
// person is comes from what is already saved, so they can leave and resume.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { supabase, userId, profile, state } = await requireUserProfile();

  // Finished people do not belong here.
  const away = onboardingRedirect(state);
  if (away) redirect(away);

  const { step: requested } = await searchParams;
  const step = stepToShow(requested, state);
  const index = STEPS.indexOf(step);
  const following = nextStep(step);
  const next = following ? `/onboarding?step=${following}` : undefined;
  const previous = index > 0 ? STEPS[index - 1] : null;

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          Step {index + 1} of {STEPS.length}
        </p>
        <div
          className="bg-muted h-1.5 rounded-full"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
        >
          <div
            className="bg-primary h-1.5 rounded-full"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {STEP_TITLES[step]}
        </h1>
      </div>

      {step === "basics" && <BasicsForm profile={profile} next={next} />}
      {step === "values" && <ValuesForm profile={profile} next={next} />}
      {step === "prompts" && <PromptsForm profile={profile} next={next} />}
      {step === "interests" && <InterestsForm profile={profile} next={next} />}
      {step === "photos" && (
        <div className="space-y-6">
          <PhotoManager
            userId={userId}
            initialPhotos={await signedPhotos(supabase, profile.photos ?? [])}
          />
          <FinishForm hasPhoto={(profile.photos?.length ?? 0) >= 1} />
        </div>
      )}

      {previous && (
        <Link
          href={`/onboarding?step=${previous}`}
          className="text-sm underline"
        >
          Back
        </Link>
      )}
    </section>
  );
}
