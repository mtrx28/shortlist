"use client";

import { useState, useTransition } from "react";
import { demoFastForwardAction } from "@/app/chat/[id]/actions";
import { Button } from "@/components/ui/button";
import { FAST_FORWARD_STEPS } from "@/lib/conversation/demo";

// Demo controls: move this chat's clock forward so the reminder, the day-3
// decision and expiry can be seen without waiting. Only shown when the server
// has DEMO_CONTROLS=true and the chat involves a demo account; the server
// action checks both again.
export function DemoPanel({
  conversationId,
  onDone,
}: {
  conversationId: string;
  onDone: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section
      aria-label="Demo controls"
      className="space-y-2 rounded-lg border border-dashed p-4"
    >
      <h2 className="text-sm font-semibold">Demo controls</h2>
      <p className="text-muted-foreground text-xs">
        For the demo only. These move this chat&apos;s clock forward so you do
        not have to wait days. They are not part of the real product.
      </p>
      <ul className="space-y-2">
        {FAST_FORWARD_STEPS.map((s) => (
          <li key={s.step} className="space-y-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await demoFastForwardAction({
                    conversationId,
                    step: s.step,
                  });
                  setMessage(result.message);
                  if (result.ok) onDone();
                })
              }
            >
              {s.label}
            </Button>
            <p className="text-muted-foreground text-xs">{s.help}</p>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-xs">
        {message}
      </p>
    </section>
  );
}
