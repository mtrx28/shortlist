import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminProfile } from "./auth";

// The admin check. It runs on the server, on every request, and does not trust
// the cookie alone:
//   1. getUser() asks Supabase to validate the session token.
//   2. The role is read from the database (not from the token or the URL).
// Next.js layouts are not re-run on every client-side navigation, so every
// admin page and every admin server action calls this itself instead of
// relying on the layout or the middleware.

export type AdminContext = { supabase: SupabaseClient; adminId: string };

type Check =
  | { kind: "admin"; ctx: AdminContext }
  | { kind: "signed_out" }
  | { kind: "forbidden" };

async function check(): Promise<Check> {
  const supabase = await createClient();
  if (!supabase) return { kind: "signed_out" };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { kind: "signed_out" };
  const { data: row } = await supabase
    .from("profiles")
    .select("role, suspended_at, deleted_at")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!isAdminProfile(row)) return { kind: "forbidden" };
  return { kind: "admin", ctx: { supabase, adminId: data.user.id } };
}

// Returns null when the caller is not a signed-in admin. Server actions use
// this one so they can answer with an error instead of a page.
export async function getAdmin(): Promise<AdminContext | null> {
  const result = await check();
  return result.kind === "admin" ? result.ctx : null;
}

// For pages: signed-out visitors go to login, anyone else who is not an admin
// gets a plain 404, so the page does not even confirm that it exists.
export async function requireAdmin(): Promise<AdminContext> {
  const result = await check();
  if (result.kind === "signed_out") redirect("/login?next=/admin");
  if (result.kind === "forbidden") notFound();
  return result.ctx;
}
