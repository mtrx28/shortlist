"use client";

import { requestVerificationAction } from "@/app/profile-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/auth/form-bits";
import { TextInput, FieldErrors } from "@/components/onboarding/inputs";
import { useStepForm } from "@/components/onboarding/use-step-form";

type Status = "none" | "pending" | "verified";

// The eLitmus verification request. It is a simulation for this demo, and the
// copy says so. The pH score is never asked for or shown.
export function VerificationCard({ status }: { status: Status }) {
  const { state, pending, onSubmit } = useStepForm(requestVerificationAction);

  return (
    <div className="space-y-3">
      <p className="bg-muted rounded-md p-3 text-sm">
        <strong>Demo only.</strong> This is a simulated check. It does not look
        anything up at eLitmus. In a real launch, eLitmus would confirm your
        identity with a signed token from your pH account.
      </p>

      {status === "verified" ? (
        <p className="text-sm font-medium">
          You have the &quot;Verified via eLitmus&quot; badge (demo).
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {status === "pending" && (
            <p className="text-sm">
              Your request is pending. You can submit a different ID if you made
              a typo.
            </p>
          )}
          <TextInput
            name="phId"
            label="pH ID"
            hint="Format check only. We store a scrambled (hashed) copy, never the ID itself. We never ask for your pH score."
            maxLength={30}
            state={state}
          />
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="consent" className="mt-1" />
              <span>
                I agree to Shortlist checking my pH ID for verification (demo).
              </span>
            </label>
            <FieldErrors state={state} name="consent" />
          </div>
          <FormMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Sending..." : "Request verification"}
          </Button>
        </form>
      )}
    </div>
  );
}
