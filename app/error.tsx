"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";

// Shown when a page fails while it is being drawn. The message is deliberately
// vague: error details can contain things people should not see, so they stay
// in the server log. `digest` is a short code that matches that log line.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page error", error.digest ?? "");
  }, [error]);

  return (
    <section className="space-y-4" aria-labelledby="err-title">
      <h1 id="err-title" className="text-2xl font-semibold tracking-tight">
        Something went wrong on our side
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Your data is safe and nothing you did caused this. Try again in a
        moment. If it keeps happening, tell us on the contact page.
        {error.digest ? ` Reference: ${error.digest}.` : ""}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to the start
        </Link>
        <Link
          href="/grievance"
          className={buttonVariants({ variant: "ghost" })}
        >
          Contact us
        </Link>
      </div>
    </section>
  );
}
