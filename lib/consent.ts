// Version of the Terms and Privacy text people agree to at signup. Bump it
// whenever either page changes in a way that needs fresh consent.
export const POLICY_VERSION = "2026-11-draft-1";

// What the signup form sends to Supabase as user metadata. A database trigger
// (handle_new_user) reads these fields, refuses the signup if consent is
// missing, and writes the consent rows with the server's own timestamp.
export function buildSignupMetadata(input: {
  displayName: string;
  dob: string; // YYYY-MM-DD, already validated
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
}) {
  return {
    display_name: input.displayName,
    dob: input.dob,
    accepted_terms: input.acceptedTerms,
    accepted_privacy: input.acceptedPrivacy,
    consent_version: POLICY_VERSION,
  };
}
