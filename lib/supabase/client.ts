import { createBrowserClient } from "@supabase/ssr";

// Supabase client for the browser. Uses only the public anon key; row level
// security and storage policies decide what the signed-in user can do.
export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
