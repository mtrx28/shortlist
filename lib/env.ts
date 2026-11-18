// Reads Supabase settings from the environment. The app must still build and
// run its public pages when they are missing, so nothing here throws at import.

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

// The public address of the app. NEXT_PUBLIC_APP_URL wins; on Vercel the
// production domain it provides is the next best thing, so link previews and
// the sitemap-style URLs are right even if the variable was forgotten.
export function getAppUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
