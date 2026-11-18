// Is this address on the machine running the code? The test tools and the seed
// script use it as a hard stop: tests that create and delete users must only
// ever talk to the local Supabase stack, never to the real project.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
