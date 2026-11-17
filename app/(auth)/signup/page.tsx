import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata = { title: "Sign up | Shortlist" };

export default function SignupPage() {
  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="text-muted-foreground text-sm">
        Shortlist is for adults only. We will email you a link to confirm your
        address.
      </p>
      <SignupForm />
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </section>
  );
}
