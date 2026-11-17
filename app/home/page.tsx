import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

// Reads the session, so it must never be prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Home | Shortlist" };

// Placeholder for signed-in users. The middleware already sends signed-out
// visitors to /login; this page reads the profile to prove RLS lets you see yours.
export default async function HomePage() {
  const supabase = await createClient();
  const { data: auth } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const { data: profile } =
    supabase && auth.user
      ? await supabase
          .from("profiles")
          .select("display_name, verified_email")
          .eq("id", auth.user.id)
          .single()
      : { data: null };

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hello{profile ? `, ${profile.display_name}` : ""}
      </h1>
      <p className="text-muted-foreground text-sm">
        You are signed in. Onboarding and your first Shortlist come next.
      </p>
      <form action={logoutAction}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </section>
  );
}
