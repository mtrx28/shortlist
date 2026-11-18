import { POLICY_VERSION } from "@/lib/consent";

// Working out what a person has agreed to from the append-only consents list.
// The current answer for each kind is its newest row.

export type ConsentRow = {
  kind: "terms" | "privacy" | "marketing" | "elitmus_data_sharing";
  policy_version: string;
  granted: boolean;
  at: string;
};

export type CurrentConsent = {
  kind: ConsentRow["kind"];
  granted: boolean;
  policyVersion: string;
  at: string;
};

export function currentConsents(rows: ConsentRow[]): CurrentConsent[] {
  const latest = new Map<string, ConsentRow>();
  for (const row of rows) {
    const seen = latest.get(row.kind);
    if (!seen || new Date(row.at) >= new Date(seen.at)) {
      latest.set(row.kind, row);
    }
  }
  return [...latest.values()].map((r) => ({
    kind: r.kind,
    granted: r.granted,
    policyVersion: r.policy_version,
    at: r.at,
  }));
}

// True when the Terms or Privacy notice changed since the person agreed. The
// signup trigger writes both rows with the version at the time.
export function needsReconsent(
  rows: ConsentRow[],
  current: string = POLICY_VERSION,
): boolean {
  const now = currentConsents(rows);
  return (["terms", "privacy"] as const).some((kind) => {
    const c = now.find((x) => x.kind === kind);
    return !c || !c.granted || c.policyVersion !== current;
  });
}

export const CONSENT_COPY: Record<
  "marketing" | "elitmus_data_sharing",
  { title: string; what: string; effectOfWithdrawing: string }
> = {
  elitmus_data_sharing: {
    title: "Share my eLitmus verification",
    what: "Lets us check your pH ID with eLitmus so your profile can show the Verified badge.",
    effectOfWithdrawing:
      "Your verification is removed: the badge disappears and we forget the stored pH ID fingerprint. You can ask for verification again later.",
  },
  marketing: {
    title: "News and updates by email",
    what: "Occasional product news. Never needed to use Shortlist.",
    effectOfWithdrawing:
      "We stop sending news. Messages about your account and safety are not marketing and still reach you.",
  },
};
