"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, RotateCcw } from "lucide-react";
import { secondLookAction } from "@/app/shortlist/actions";
import { Button } from "@/components/ui/button";

// Second look (a Plus perk): once every few weeks, bring back one intro you
// passed on or let expire. Free members see what it is and where to get it.
// The server decides everything; this only lists the choices.
export type SecondLookOption = {
  id: string;
  name: string;
  city: string | null;
  week: string; // Monday of the drop, YYYY-MM-DD
};

const DAY = 24 * 3600 * 1000;

export function SecondLook({
  isPlus,
  usedAt,
  perDays,
  revivedHours,
  options,
  now,
}: {
  isPlus: boolean;
  usedAt: string | null;
  perDays: number;
  revivedHours: number;
  options: SecondLookOption[];
  now: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nextAt = usedAt
    ? new Date(new Date(usedAt).getTime() + perDays * DAY)
    : null;
  const waiting = nextAt !== null && nextAt.getTime() > new Date(now).getTime();

  return (
    <section
      aria-label="Second look"
      className="space-y-3 rounded-lg border border-dashed p-4"
    >
      <h2 className="flex items-center gap-2 text-base font-medium">
        {isPlus ? (
          <RotateCcw className="size-4" aria-hidden />
        ) : (
          <Lock className="size-4" aria-hidden />
        )}
        Second look
      </h2>
      <p className="text-muted-foreground text-sm">
        Changed your mind about an intro you passed on or let expire in the last
        four weeks? A second look brings one back for {revivedHours} hours. They
        are not told. If they had also said Interested, answering Interested now
        opens the chat as usual.
      </p>

      {!isPlus && (
        <p className="text-sm">
          Second look comes with{" "}
          <Link href="/plus" className="underline">
            Plus
          </Link>
          : one every {perDays} days.
        </p>
      )}

      {isPlus && waiting && nextAt && (
        <p className="text-sm">
          You used your second look recently. The next one is available on{" "}
          {nextAt.toLocaleDateString("en-IN", {
            dateStyle: "long",
            timeZone: "Asia/Kolkata",
          })}
          .
        </p>
      )}

      {isPlus && !waiting && options.length === 0 && (
        <p className="text-sm">
          There is nothing to bring back right now. Intros you pass on or let
          expire will show up here for four weeks.
        </p>
      )}

      {isPlus && !waiting && options.length > 0 && (
        <ul className="space-y-2">
          {options.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {o.name}
                {o.city ? `, ${o.city}` : ""}{" "}
                <span className="text-muted-foreground">
                  (drop of week {o.week})
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                aria-label={`Take a second look at ${o.name}`}
                onClick={() =>
                  startTransition(async () => {
                    const result = await secondLookAction(o.id);
                    setMessage(result.message);
                    if (result.ok) router.refresh();
                  })
                }
              >
                Take a second look
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="min-h-5 text-sm">
        {message}
      </p>
    </section>
  );
}
