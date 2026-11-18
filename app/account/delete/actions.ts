"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { SAFETY_CONFIG } from "@/config/safety";
import { deleteAccount } from "@/lib/account/delete";
import { passwordIsCorrect } from "@/lib/account/reauth";
import { retryAfterSlotsFreed } from "@/lib/conversation/after-close";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/validators/auth";

// Deleting an account cannot be undone, so three things must be true:
//   1. the person is signed in (from the session cookie);
//   2. they typed the confirmation word;
//   3. they entered their password again (re-authentication), so someone who
//      walks up to an unlocked phone cannot delete the account.
// Wrong passwords are counted in the events table; after a few in an hour we
// stop checking and ask them to wait.

const schema = z.object({
  password: z.string().min(1, "Enter your password.").max(200),
  confirm: z.string(),
});

export async function deleteAccountAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = schema.safeParse({
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  if (parsed.data.confirm.trim() !== SAFETY_CONFIG.deleteConfirmPhrase) {
    return {
      fieldErrors: {
        confirm: [`Type ${SAFETY_CONFIG.deleteConfirmPhrase} to confirm.`],
      },
    };
  }

  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) return { error: "This server is not set up yet." };
  const { data } = await supabase.auth.getUser();
  if (!data.user || !data.user.email) return { error: "Please log in again." };
  const userId = data.user.id;

  // Too many wrong passwords recently?
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await service
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("name", "delete_reauth_failed")
    .gte("at", since);
  if ((count ?? 0) >= SAFETY_CONFIG.deleteReauthMaxFailuresPerHour) {
    return {
      error:
        "Too many wrong passwords. Please wait an hour and try again, or reset your password.",
    };
  }

  const correct = await passwordIsCorrect(
    data.user.email,
    parsed.data.password,
  );
  if (!correct) {
    await logEvent("delete_reauth_failed", userId);
    return { fieldErrors: { password: ["That password is not correct."] } };
  }

  const result = await deleteAccount(service, userId);
  if (!result.ok) {
    if (result.code === "admin_account") {
      return {
        error:
          "Admin accounts cannot be deleted from the app. Ask another admin to remove the role first.",
      };
    }
    return {
      error:
        "We could not delete your account just now. Nothing was removed that cannot be tried again. Please try once more, or contact us.",
    };
  }

  // Their chats are gone, so the other people's slots are free again.
  await retryAfterSlotsFreed(service, result.freedUserIds);

  // The login no longer exists; clear the cookies on this device.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/goodbye");
}
