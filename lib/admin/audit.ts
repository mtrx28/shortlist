// Builds the row written to audit_log whenever an admin does something that
// matters. Keeping this in one place means every admin action is recorded in
// the same shape: who did it, what they did, and to what.

export const AUDIT_ACTIONS = [
  "verification_approved",
  "verification_rejected",
  "drop_run",
  // Written by the safety database functions (see the safety migration).
  "report_acknowledged",
  "report_actioned",
  "report_dismissed",
  "report_evidence_viewed",
  "user_suspended",
  "user_unsuspended",
  "contact_handled",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuditEntry = {
  admin_id: string;
  action: AuditAction;
  target: string; // for example "profile:<uuid>"
};

// Throws on bad input, so a malformed row can never be written by mistake.
export function buildAuditEntry(input: {
  adminId: string;
  action: AuditAction;
  targetType: "profile" | "drop" | "report" | "contact";
  targetId: string;
}): AuditEntry {
  if (!UUID.test(input.adminId)) throw new Error("Invalid admin id.");
  if (!UUID.test(input.targetId)) throw new Error("Invalid target id.");
  if (!AUDIT_ACTIONS.includes(input.action)) {
    throw new Error("Unknown audit action.");
  }
  return {
    admin_id: input.adminId,
    action: input.action,
    target: `${input.targetType}:${input.targetId}`,
  };
}
