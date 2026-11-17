import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

// Landing point for the links in Supabase emails (confirm email, reset
// password). It trades the one-time token in the link for a real session,
// then sends the person on. Supports both link styles Supabase can send:
//   ?token_hash=...&type=...   (custom email template, recommended)
//   ?code=...                  (default PKCE link)
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let ok = false;

  if (supabase && tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    ok = !error;
  } else if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (ok) {
    target.pathname = next;
  } else {
    target.pathname = "/login";
    target.searchParams.set("error", "link");
  }
  return NextResponse.redirect(target);
}
