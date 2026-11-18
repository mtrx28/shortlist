import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  CONSENT_COPY,
  currentConsents,
  needsReconsent,
  type ConsentRow,
} from "@/lib/account/consents";
import { POLICY_VERSION } from "@/lib/consent";
import { requireSession } from "@/lib/profile";
import { acceptPolicyUpdateAction, setConsentAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy and consents | Shortlist" };

const RESULT_TEXT: Record<string, string> = {
  withdrawn: "Done. That consent is withdrawn.",
  given: "Done. Thank you.",
  accepted: "Thank you. We have recorded that you accepted the update.",
  failed: "We could not save that. Please try again.",
  invalid: "That did not look right.",
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export default async function PrivacyAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  const { supabase, userId } = await requireSession();

  // Your own consent rows (row level security: only yours come back).
  const { data } = await supabase
    .from("consents")
    .select("kind, policy_version, granted, at")
    .eq("user_id", userId)
    .order("at", { ascending: true });
  const rows = (data ?? []) as ConsentRow[];
  const current = currentConsents(rows);
  const byKind = new Map(current.map((c) => [c.kind, c]));
  const update = needsReconsent(rows);

  return (
    <section className="mx-auto max-w-xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Privacy and consents
        </h1>
        <p className="text-muted-foreground text-sm">
          What you agreed to, when, and what happens if you change your mind.
          Current text version: {POLICY_VERSION}.
        </p>
      </div>

      {result && RESULT_TEXT[result] && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {RESULT_TEXT[result]}
        </p>
      )}

      {update && (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">Our Terms or Privacy Notice changed</p>
          <p className="text-muted-foreground">
            Please read the{" "}
            <Link href="/terms" className="underline">
              Terms
            </Link>{" "}
            and the{" "}
            <Link href="/privacy" className="underline">
              Privacy Notice
            </Link>{" "}
            and confirm that you accept the new version.
          </p>
          <form action={acceptPolicyUpdateAction}>
            <Button type="submit">I accept the updated version</Button>
          </form>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-medium">Needed to use Shortlist</h2>
        <ul className="divide-y rounded-lg border text-sm">
          {(["terms", "privacy"] as const).map((kind) => {
            const c = byKind.get(kind);
            return (
              <li key={kind} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  {kind === "terms" ? "Terms of use" : "Privacy Notice"}
                </span>
                <span className="text-muted-foreground text-right">
                  {c
                    ? `accepted, version ${c.policyVersion}, ${when(c.at)}`
                    : "not recorded"}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground text-sm">
          These cannot be withdrawn while you have an account. To withdraw them,{" "}
          <Link href="/account/delete" className="underline">
            delete your account
          </Link>
          .
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">Optional</h2>
        {(["elitmus_data_sharing", "marketing"] as const).map((kind) => {
          const c = byKind.get(kind);
          const copy = CONSENT_COPY[kind];
          const granted = c?.granted === true;
          return (
            <div key={kind} className="space-y-2 rounded-lg border p-4 text-sm">
              <p className="font-medium">{copy.title}</p>
              <p className="text-muted-foreground">{copy.what}</p>
              <p>
                Status:{" "}
                <strong>
                  {granted ? "given" : c ? "withdrawn" : "not given"}
                </strong>
                {c ? (
                  <span className="text-muted-foreground">
                    {" "}
                    (version {c.policyVersion}, {when(c.at)})
                  </span>
                ) : null}
              </p>
              {granted ? (
                <>
                  <p className="text-muted-foreground">
                    If you withdraw: {copy.effectOfWithdrawing}
                  </p>
                  <form action={setConsentAction}>
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="granted" value="false" />
                    <Button type="submit" variant="outline">
                      Withdraw
                    </Button>
                  </form>
                </>
              ) : kind === "marketing" ? (
                <form action={setConsentAction}>
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="granted" value="true" />
                  <Button type="submit" variant="outline">
                    Give consent
                  </Button>
                </form>
              ) : (
                <p className="text-muted-foreground">
                  To share again, ask for verification on{" "}
                  <Link href="/account/profile" className="underline">
                    your profile
                  </Link>
                  .
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-medium">Your data</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <Link href="/account/export" className="underline">
              Download my data
            </Link>
          </li>
          <li>
            <Link href="/account/delete" className="underline">
              Delete my account
            </Link>
          </li>
          <li>
            <Link href="/grievance" className="underline">
              Raise a complaint or ask us something
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
