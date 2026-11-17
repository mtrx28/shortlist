import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/env";

// Supabase client for server components, server actions and route handlers.
// It acts as the signed-in user (from the session cookie), so RLS applies.
// Returns null when Supabase is not configured yet.
export async function createClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components cannot set cookies. The middleware refreshes
          // the session, so ignoring this is safe.
        }
      },
    },
  });
}
