"use server";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { POLICY_VERSION } from "@/lib/consent";
import { hashPhId, isDemoAutoVerify } from "@/lib/elitmus";
import { logEvent } from "@/lib/events";
import { PHOTO_BUCKET } from "@/lib/photos";
import { fetchMyProfile, signedPhotos, type SignedPhoto } from "@/lib/profile";
import { safeNextPath } from "@/lib/safe-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toFormState, type FormState } from "@/lib/validators/auth";
import {
  basicsSchema,
  BASICS_ARRAY_FIELDS,
  elitmusRequestSchema,
  formToObject,
  interestsSchema,
  INTERESTS_ARRAY_FIELDS,
  makePhotosSchema,
  pauseSchema,
  promptsSchema,
  toStoredPrompts,
  toStoredValues,
  valuesSchema,
  VALUES_ARRAY_FIELDS,
} from "@/lib/validators/profile";

// Server actions for onboarding and the profile page. Every one checks who is
// signed in, validates its input with Zod, and writes with the signed-in
// user's own client, so the database rules (RLS and column grants) apply
// again on top of these checks. The one exception is the eLitmus request,
// which needs the service role (see below).

const SAVE_FAILED: FormState = {
  error: "We could not save that. Please try again.",
};

async function currentUser(): Promise<
  { supabase: SupabaseClient; user: User } | { error: FormState }
> {
  const supabase = await createClient();
  if (!supabase) return { error: { error: "This server is not set up yet." } };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: { error: "Please log in again." } };
  return { supabase, user: data.user };
}

// After a successful save: go to the page named in the hidden "next" field
// (onboarding moves on to the next step), or just say "Saved" (profile page).
function afterSave(form: FormData): FormState {
  const next = safeNextPath(form.get("next"), "");
  revalidatePath("/account/profile");
  if (next) redirect(next);
  return { message: "Saved." };
}

// The same shape for the four form steps: validate, convert, update the row.
async function saveStep(
  form: FormData,
  schema: ZodType,
  arrayFields: string[],
  toColumns: (parsed: Record<string, unknown>) => Record<string, unknown>,
): Promise<FormState> {
  const parsed = schema.safeParse(formToObject(form, arrayFields));
  if (!parsed.success) return toFormState(parsed.error);

  const who = await currentUser();
  if ("error" in who) return who.error;

  const { error } = await who.supabase
    .from("profiles")
    .update(toColumns(parsed.data as Record<string, unknown>))
    .eq("id", who.user.id);
  if (error) return SAVE_FAILED;
  return afterSave(form);
}

export async function saveBasicsAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return saveStep(form, basicsSchema, BASICS_ARRAY_FIELDS, (p) => ({
    display_name: p.displayName,
    gender: p.gender,
    interested_in: p.interestedIn,
    city: p.city,
    intent: p.intent,
    batch_year: p.batchYear,
    occupation: p.occupation,
    college_tier: p.collegeTier ?? null,
  }));
}

export async function saveValuesAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return saveStep(form, valuesSchema, VALUES_ARRAY_FIELDS, (p) => ({
    values_answers: toStoredValues(p),
  }));
}

export async function savePromptsAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return saveStep(form, promptsSchema, [], (p) => ({
    bio_prompts: toStoredPrompts(p),
  }));
}

export async function saveInterestsAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return saveStep(form, interestsSchema, INTERESTS_ARRAY_FIELDS, (p) => ({
    interests: p.interests,
  }));
}

// ---------------------------------------------------------------------------
// Photos. The browser compresses and uploads each file straight to Storage
// (where the storage policy checks the folder). Then it calls this to save the
// list of paths on the profile. Removing a photo deletes its file too.
// ---------------------------------------------------------------------------
export type PhotosResult = { error?: string; photos?: SignedPhoto[] };

export async function savePhotosAction(paths: string[]): Promise<PhotosResult> {
  const who = await currentUser();
  if ("error" in who) return { error: who.error.error };
  const { supabase, user } = who;

  const parsed = makePhotosSchema(user.id).safeParse(paths);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid photos." };
  }

  // Every saved path must be a file that was really uploaded to our folder.
  const { data: files } = await supabase.storage
    .from(PHOTO_BUCKET)
    .list(user.id, { limit: 100 });
  const existing = new Set((files ?? []).map((f) => `${user.id}/${f.name}`));
  if (!parsed.data.every((p) => existing.has(p))) {
    return { error: "A photo did not finish uploading. Please try again." };
  }

  const before = await fetchMyProfile(supabase, user.id);
  const { error } = await supabase
    .from("profiles")
    .update({ photos: parsed.data })
    .eq("id", user.id);
  if (error) return { error: "We could not save your photos." };

  const removed = (before?.photos ?? []).filter(
    (p) => !parsed.data.includes(p),
  );
  if (removed.length > 0) {
    await supabase.storage.from(PHOTO_BUCKET).remove(removed);
  }

  revalidatePath("/account/profile");
  revalidatePath("/onboarding");
  return { photos: await signedPhotos(supabase, parsed.data) };
}

// Last onboarding step. The database function re-checks that everything is
// filled in before it sets the completed flag, so this cannot be faked.
export async function finishOnboardingAction(): Promise<FormState> {
  const who = await currentUser();
  if ("error" in who) return who.error;

  const { data, error } = await who.supabase.rpc("complete_onboarding");
  if (error) return SAVE_FAILED;
  if (data !== true) {
    return {
      error:
        "A few answers are still missing. Go back through the steps to finish them.",
    };
  }
  await logEvent("onboarding_completed", who.user.id);
  redirect("/home");
}

// ---------------------------------------------------------------------------
// Pause: hides the profile from future matching. Users may write this column.
// ---------------------------------------------------------------------------
export async function setPausedAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = pauseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return SAVE_FAILED;

  const who = await currentUser();
  if ("error" in who) return who.error;

  const { error } = await who.supabase
    .from("profiles")
    .update({ paused: parsed.data.paused })
    .eq("id", who.user.id);
  if (error) return SAVE_FAILED;

  revalidatePath("/account/profile");
  return {
    message: parsed.data.paused
      ? "Your profile is paused. You will not get new introductions."
      : "Welcome back. Your profile is active again.",
  };
}

// ---------------------------------------------------------------------------
// eLitmus verification (SIMULATED for this demo).
// Users cannot write elitmus_status or elitmus_ref_hash (no column grant), so
// this uses the service-role client, after strict checks:
//   * the person is signed in and the form is valid;
//   * they ticked the consent box (stored as a consent record);
//   * a verified account is never touched again;
//   * only the HMAC of the ID is stored, with a secret kept on the server;
//   * the status can only become "pending", or "verified" when the demo flag
//     DEMO_AUTO_VERIFY=true is set on the server.
// ---------------------------------------------------------------------------
export async function requestVerificationAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = elitmusRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return toFormState(parsed.error);

  const who = await currentUser();
  if ("error" in who) return who.error;

  const secret = process.env.ELITMUS_HASH_SECRET;
  const admin = createAdminClient();
  if (!secret || !admin) {
    return { error: "Verification is not set up on this server yet." };
  }

  const profile = await fetchMyProfile(who.supabase, who.user.id);
  if (profile?.elitmus_status === "verified") {
    return { message: "You are already verified." };
  }

  // Record the consent first, using the user's own client (RLS applies).
  const { error: consentError } = await who.supabase.from("consents").insert({
    user_id: who.user.id,
    kind: "elitmus_data_sharing",
    policy_version: POLICY_VERSION,
    granted: true,
  });
  if (consentError) return SAVE_FAILED;

  const status = isDemoAutoVerify() ? "verified" : "pending";
  const { error } = await admin
    .from("profiles")
    .update({
      elitmus_status: status,
      elitmus_ref_hash: hashPhId(parsed.data.phId, secret),
    })
    .eq("id", who.user.id)
    .neq("elitmus_status", "verified");

  if (error) {
    // 23505 = the unique index: this pH ID hash is already on another account.
    if (error.code === "23505") {
      return {
        error: "That pH ID is already linked to another account.",
      };
    }
    return SAVE_FAILED;
  }

  await logEvent("elitmus_verification_requested", who.user.id, { status });
  revalidatePath("/account/profile");
  return {
    message:
      status === "verified"
        ? "Demo mode: you are marked as verified."
        : "Request received. This is a demo, so it stays pending until an admin approves it.",
  };
}
