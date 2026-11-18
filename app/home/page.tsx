import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { homeRedirect } from "@/lib/onboarding";
import { requireUserProfile } from "@/lib/profile";

// Reads the session, so it must never be prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Home | Shortlist" };

// Signed-in home, with the way to the shortlist and chats. People who have
// not finished onboarding are sent there first.
export default async function HomePage() {
  const { profile, state } = await requireUserProfile();

  const away = homeRedirect(state);
  if (away) redirect(away);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hello, {profile.display_name}
      </h1>
      <p className="text-muted-foreground text-sm">
        Your profile is ready. Your introductions arrive every Sunday evening.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/shortlist"
          className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
        >
          Your shortlist
        </Link>
        <Link
          href="/chat"
          className="border-border inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium"
        >
          Chats
        </Link>
      </div>
      {profile.paused && (
        <p className="bg-muted rounded-md p-3 text-sm">
          Your profile is paused, so you will not get new introductions.
        </p>
      )}
      {profile.role === "admin" && (
        <p className="text-sm">
          <Link href="/admin" className="underline">
            Admin area
          </Link>
        </p>
      )}
      <p className="text-sm">
        <Link href="/account/profile" className="underline">
          Edit your profile
        </Link>
      </p>
      <form action={logoutAction}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </section>
  );
}
