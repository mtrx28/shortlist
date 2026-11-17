import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata = { title: "Log in | Shortlist" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      {error === "link" && (
        <p className="text-destructive text-sm" role="alert">
          That link is invalid or has expired. Log in, or ask for a new link.
        </p>
      )}
      <LoginForm next={safeNextPath(next)} />
      <p className="text-sm">
        New here?{" "}
        <Link href="/signup" className="underline">
          Create an account
        </Link>
      </p>
    </section>
  );
}
