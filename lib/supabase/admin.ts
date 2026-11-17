import { createClient } from "@supabase/supabase-js";

// Service-role client: skips RLS. Server code only, and only for jobs that
// must act beyond one user (events, matching, payments, moderation).
// Never import this from a client component.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
