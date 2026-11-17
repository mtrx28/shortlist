import { createAdminClient } from "@/lib/supabase/admin";

// Product events (signup, login, and later intro_viewed, kept, reported...).
// They feed the admin stats. Logging must never break the request, so errors
// are swallowed. Do not put personal data in `props`.
export async function logEvent(
  name: string,
  userId: string | null,
  props: Record<string, string | number | boolean> = {},
) {
  try {
    const admin = createAdminClient();
    if (!admin) return;
    await admin.from("events").insert({ name, user_id: userId, props });
  } catch {
    // intentionally ignored
  }
}
