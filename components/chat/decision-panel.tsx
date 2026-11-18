"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { decideAction } from "@/app/chat/[id]/actions";
import { Button } from "@/components/ui/button";
import { CLOSE_TEMPLATES } from "@/config/conversation";
import type { ChatDecision } from "@/lib/conversation/state";

// The day-3 screen. Both of you have written, so each of you says whether to
// keep talking. It explains what each choice does before you press anything.
export function DecisionPanel({
  conversationId,
  otherName,
  myDecision,
  onDone,
}: {
  conversationId: string;
  otherName: string;
  myDecision: ChatDecision | null;
  onDone: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [templateId, setTemplateId] = useState<string>(CLOSE_TEMPLATES[0].id);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // When the panel appears, move focus to its heading so a screen reader
  // announces it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function submit(decision: ChatDecision) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await decideAction({
        conversationId,
        decision,
        templateId: decision === "close" ? templateId : undefined,
      });
      if (result.ok) {
        setMessage(result.message);
        setClosing(false);
        onDone();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <section
      aria-labelledby="decision-heading"
      className="bg-card space-y-4 rounded-lg border-2 p-4"
    >
      <div className="space-y-1">
        <h2
          id="decision-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Day 3: do you want to keep talking to {otherName}?
        </h2>
        <p className="text-muted-foreground text-sm">
          You have both written, so now is the time to choose. Take a moment;
          there is no wrong answer.
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        <li>
          <strong>Keep talking:</strong> the chat stays open with no time limit
          and keeps using one of your chat slots. It only becomes a kept chat if
          you both choose this. We will not tell {otherName} what you chose
          unless they choose it too.
        </li>
        <li>
          <strong>Close kindly:</strong> the chat ends now and {otherName} sees
          a short, kind note that you pick. It frees your slot. This cannot be
          undone.
        </li>
        <li className="text-muted-foreground">
          If one of you has not chosen when the time is up, the chat simply
          ends.
        </li>
      </ul>

      {myDecision === "keep" && !closing && (
        <p className="bg-muted rounded-md p-3 text-sm" role="status">
          You chose to keep talking. We are waiting to see if {otherName} does
          too. You can still change your mind and close kindly.
        </p>
      )}

      {closing ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Pick the note {otherName} will see
          </legend>
          {CLOSE_TEMPLATES.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"
            >
              <input
                type="radio"
                name="close-template"
                value={t.id}
                checked={templateId === t.id}
                onChange={() => setTemplateId(t.id)}
                className="mt-1"
              />
              <span>{t.text}</span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              onClick={() => submit("close")}
              disabled={pending}
            >
              {pending ? "Closing..." : "Close this chat kindly"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClosing(false)}
              disabled={pending}
            >
              Go back
            </Button>
          </div>
        </fieldset>
      ) : (
        <div className="flex flex-wrap gap-2">
          {myDecision !== "keep" && (
            <Button
              type="button"
              onClick={() => submit("keep")}
              disabled={pending}
            >
              {pending ? "Saving..." : "Keep talking"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => setClosing(true)}
            disabled={pending}
          >
            Close kindly
          </Button>
        </div>
      )}

      <div aria-live="polite">
        {message && <p className="text-sm">{message}</p>}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
