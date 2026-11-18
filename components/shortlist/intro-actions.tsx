"use client";

import { useState, useTransition, type FormEvent } from "react";
import { answerIntroAction } from "@/app/shortlist/actions";
import { Button } from "@/components/ui/button";
import { SHORTLIST_CONFIG } from "@/config/shortlist";
import type { FormState } from "@/lib/validators/auth";

// Pass / Interested for one intro, with the optional note. The buttons are
// switched off while a request is running, which stops most double clicks;
// the database makes a repeated answer harmless anyway.
export function IntroActions({
  introId,
  status,
  atCap,
  capText,
}: {
  introId: string;
  status: "new" | "passed" | "interested" | "expired";
  atCap: boolean;
  capText: string;
}) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Include the button that was pressed (Pass or Interested).
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(
      event.currentTarget,
      submitter as HTMLElement | null,
    );
    startTransition(async () => {
      setState(await answerIntroAction(state, form));
    });
  }

  const noteError = state.fieldErrors?.note?.[0];

  return (
    <div className="space-y-3">
      {status === "new" && (
        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" name="introId" value={introId} />
          <div className="space-y-1">
            <label htmlFor={`note-${introId}`} className="text-sm font-medium">
              Add a short note (optional)
            </label>
            <textarea
              id={`note-${introId}`}
              name="note"
              rows={2}
              maxLength={SHORTLIST_CONFIG.noteMaxLength}
              placeholder="Only shown if you both say yes. No links or phone numbers."
              aria-invalid={noteError ? true : undefined}
              disabled={atCap || pending}
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
            />
            {noteError && (
              <p className="text-destructive text-xs" role="alert">
                {noteError}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="submit"
              name="decision"
              value="passed"
              variant="outline"
              size="lg"
              disabled={pending}
            >
              Pass
            </Button>
            <Button
              type="submit"
              name="decision"
              value="interested"
              size="lg"
              disabled={pending || atCap}
            >
              Interested
            </Button>
          </div>
          {atCap && (
            <p className="text-sm" role="note">
              You have {capText}, the most you can have at once. Finish or close
              a chat to say Interested. You can still pass.
            </p>
          )}
        </form>
      )}

      {state.error && (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="bg-muted rounded-md p-3 text-sm" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}
