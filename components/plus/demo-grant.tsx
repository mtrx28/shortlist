"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { demoGrantPlusAction } from "@/app/plus/actions";
import { Button } from "@/components/ui/button";

// Demo only: lets an evaluator try the Plus perks without paying. Shown only
// when the server has DEMO_CONTROLS=true and the account is a demo account;
// the action checks both again.
export function DemoGrant() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <section
      aria-label="Demo controls"
      className="space-y-2 rounded-lg border border-dashed p-4"
    >
      <h2 className="text-sm font-semibold">Demo controls</h2>
      <p className="text-muted-foreground text-xs">
        For the demo only: no payment is made and this button does not exist for
        real members.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await demoGrantPlusAction();
            setMessage(result.message);
            if (result.ok) router.refresh();
          })
        }
      >
        Grant me 30 days of Plus (demo)
      </Button>
      <p aria-live="polite" className="text-xs">
        {message}
      </p>
    </section>
  );
}
