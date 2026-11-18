import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "@/lib/photos";
import { callDb } from "@/lib/safety/service";
import { safetyHashSecret } from "@/lib/account/secret";

// Account deletion, in the order that cannot leave anything behind:
//   1. remove the person's photo files (Storage cannot be emptied from SQL);
//   2. call delete_account(), which removes everything in the database in ONE
//      transaction and keeps only the minimal safety record;
//   3. remove photo files once more, in case an upload slipped in between.
// If step 2 fails nothing in the database changed and the person can try
// again; the routine can be repeated safely ("already_gone" is a success).
// Service role only. The caller must have re-checked the password.

const PAGE = 100;

// Removes every file in the person's own folder. Returns how many were removed.
export async function removeAllPhotos(
  service: SupabaseClient,
  userId: string,
): Promise<number> {
  let removed = 0;
  // Listing always starts from the top: removed files drop out of the list.
  for (let round = 0; round < 50; round++) {
    const { data, error } = await service.storage
      .from(PHOTO_BUCKET)
      .list(userId, { limit: PAGE });
    if (error) throw new Error("Could not list photos.");
    const files = (data ?? []).filter((f) => f.name && f.id !== null);
    if (files.length === 0) break;
    const paths = files.map((f) => `${userId}/${f.name}`);
    const { error: rmError } = await service.storage
      .from(PHOTO_BUCKET)
      .remove(paths);
    if (rmError) throw new Error("Could not remove photos.");
    removed += paths.length;
    if (files.length < PAGE) break;
  }
  return removed;
}

export type DeleteOutcome =
  | { ok: true; status: "deleted" | "already_gone"; freedUserIds: string[] }
  | { ok: false; code: string };

export async function deleteAccount(
  service: SupabaseClient,
  userId: string,
): Promise<DeleteOutcome> {
  const secret = safetyHashSecret();
  if (!secret) return { ok: false, code: "not_configured" };

  try {
    await removeAllPhotos(service, userId);
  } catch {
    return { ok: false, code: "storage_failed" };
  }

  const result = await callDb<{
    status: "deleted" | "already_gone";
    freed_user_ids: string[];
  }>(service, "delete_account", {
    p_user: userId,
    p_pepper: secret,
    p_now: new Date().toISOString(),
  });
  if (!result.ok) return { ok: false, code: result.code };

  try {
    await removeAllPhotos(service, userId);
  } catch {
    // The account is gone; a leftover file is reported but not fatal.
    return {
      ok: true,
      status: result.value.status,
      freedUserIds: result.value.freed_user_ids,
    };
  }
  return {
    ok: true,
    status: result.value.status,
    freedUserIds: result.value.freed_user_ids,
  };
}
