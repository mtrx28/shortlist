import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  resolveOnboarding,
  type OnboardingProfile,
  type OnboardingState,
} from "@/lib/onboarding";
import { PHOTO_BUCKET } from "@/lib/photos";

// The columns a signed-in user may read from their own profile row.
// (dob and elitmus_ref_hash are never readable, even by their owner.)
export const MY_PROFILE_COLUMNS =
  "id, role, display_name, gender, interested_in, city, intent, batch_year, college_tier, occupation, bio_prompts, values_answers, interests, photos, verified_email, elitmus_status, paused, onboarding_completed_at";

export type MyProfile = OnboardingProfile & {
  id: string;
  display_name: string;
  role: "user" | "admin";
  college_tier: string | null;
  verified_email: boolean;
  elitmus_status: "none" | "pending" | "verified";
  paused: boolean;
};

export async function fetchMyProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<MyProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select(MY_PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  return (data as MyProfile | null) ?? null;
}

// For pages that need a signed-in user with a profile. Sends signed-out
// visitors to login. Returns the client too so the page can keep querying.
export async function requireUserProfile(): Promise<{
  supabase: SupabaseClient;
  userId: string;
  profile: MyProfile;
  state: OnboardingState;
}> {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const profile = await fetchMyProfile(supabase, data.user.id);
  // The signup trigger always creates a profile; if it is missing, do not
  // bounce between /login and /home.
  if (!profile) redirect("/");
  return {
    supabase,
    userId: data.user.id,
    profile,
    state: resolveOnboarding(profile),
  };
}

export type SignedPhoto = { path: string; url: string };

// Signed links to a person's photos (valid one hour). It uses the signed-in
// user's own client, so the storage policy decides whether they may see them.
// Photos that cannot be signed are skipped.
export async function signedPhotos(
  supabase: SupabaseClient,
  paths: string[],
): Promise<SignedPhoto[]> {
  if (paths.length === 0) return [];
  const { data } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, 3600);
  return (data ?? []).flatMap((d) =>
    d.signedUrl && d.path ? [{ path: d.path, url: d.signedUrl }] : [],
  );
}
