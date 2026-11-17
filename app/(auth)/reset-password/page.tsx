import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { createClient } from "@/lib/supabase/server";

// Reads the session, so it must never be prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "New password | Shortlist" };

// The reset link signs the person in first (see /auth/confirm), so this page
// only makes sense with a session.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!data.user) {
    return (
      <section className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
        <p className="text-sm">
          This reset link is not valid any more.{" "}
          <Link href="/forgot-password" className="underline">
            Ask for a new one
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      <ResetPasswordForm />
    </section>
  );
}
