import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Page not found | Shortlist" };

export default function NotFound() {
  return (
    <section className="space-y-4" aria-labelledby="nf-title">
      <h1 id="nf-title" className="text-2xl font-semibold tracking-tight">
        We could not find that page
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        The link may be old, or the page may have moved. Nothing is wrong with
        your account.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className={buttonVariants()}>
          Back to the start
        </Link>
        <Link href="/demo" className={buttonVariants({ variant: "outline" })}>
          Demo guide
        </Link>
      </div>
    </section>
  );
}
