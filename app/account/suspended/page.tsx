import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account suspended | Shortlist" };

// Where a suspended person lands. They cannot use the shortlist or chats, but
// they can still reach their data tools and the grievance page.
export default async function SuspendedPage() {
  const { supabase, userId } = await requireSession();
  const { data } = await supabase
    .from("profiles")
    .select("suspended_at")
    .eq("id", userId)
    .maybeSingle();
  const suspended = Boolean(data?.suspended_at);

  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {suspended ? "Your account is suspended" : "Your account is active"}
      </h1>
      {suspended ? (
        <>
          <p className="text-sm">
            After a report, our team suspended this account. Your profile is
            hidden and you cannot use introductions or chats. If you think this
            is a mistake, tell us on the{" "}
            <Link href="/grievance" className="underline">
              grievance page
            </Link>
            .
          </p>
          <p className="text-sm">You can still:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <Link href="/account/export" className="underline">
                download your data
              </Link>
            </li>
            <li>
              <Link href="/account/delete" className="underline">
                delete your account
              </Link>
            </li>
          </ul>
        </>
      ) : (
        <Link href="/home" className="text-sm underline">
          Go to Home
        </Link>
      )}
      <form action={logoutAction}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </section>
  );
}
