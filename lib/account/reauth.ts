import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

// Checks a password by signing in with it on a throwaway client that keeps
// nothing (no cookies, no storage), so the person's real session is not
// touched. Used before something that cannot be undone. Supabase applies its
// own rate limit to sign-in attempts as well; we add ours in the action.
export async function passwordIsCorrect(
  email: string,
  password: string,
): Promise<boolean> {
  const env = getSupabaseEnv();
  if (!env || !email || !password) return false;
  const probe = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) return false;
  // Forget the probe session on this side only (scope "local" makes no call).
  await probe.auth.signOut({ scope: "local" });
  return true;
}
