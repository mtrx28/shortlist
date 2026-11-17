import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

// Pages that need a signed-in user. Everything else is public.
export const PROTECTED_PREFIXES = [
  "/home",
  "/onboarding",
  "/shortlist",
  "/chat",
  "/admin",
  "/account",
];

// Pages only for signed-out people; signed-in users are sent to /home.
export const GUEST_ONLY_PATHS = ["/login", "/signup", "/forgot-password"];

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

// Runs on every request: refreshes the session cookie and redirects
// signed-out visitors away from protected pages.
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = getSupabaseEnv();

  if (!env) {
    // Not configured yet: public pages still work, protected ones go to login.
    if (isProtectedPath(pathname)) return redirectToLogin(request);
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() asks Supabase to check the token, so it cannot be faked with a
  // hand-made cookie (getSession() only reads the cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath(pathname)) return redirectToLogin(request);

  if (user && GUEST_ONLY_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}
