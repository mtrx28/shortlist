// Turns the outcome of the admin_review_verification() database function into
// the short result code the verifications page shows.

export type ReviewResult =
  "approved" | "rejected" | "already_handled" | "forbidden" | "failed";

// The function raises 'not_admin' or 'not_pending' (see the migration).
// Anything else is treated as a plain failure and nothing was changed.
export function reviewResultFromError(
  message: string | undefined,
): ReviewResult {
  if (!message) return "failed";
  if (message.includes("not_pending")) return "already_handled";
  if (message.includes("not_admin")) return "forbidden";
  return "failed";
}
