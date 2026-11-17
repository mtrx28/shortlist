import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Placeholder landing page. The real one comes later in the build.
export default function Home() {
  return (
    <section className="space-y-6">
      <h1 className="text-4xl font-semibold tracking-tight">
        Three introductions a week. Not three hundred.
      </h1>
      <p className="text-muted-foreground max-w-xl text-lg">
        Shortlist is a slow dating app for people verified through eLitmus.
        Fewer profiles, time-boxed conversations, and an honest way to end them.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className={buttonVariants()}>
          Create account
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Log in
        </Link>
      </div>
    </section>
  );
}
