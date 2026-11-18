import type { SupabaseClient } from "@supabase/supabase-js";
import { SAFETY_CONFIG } from "@/config/safety";

// Thin wrappers around the safety database functions (see the safety
// migration). They need the service-role client, so the caller must pass the
// id of the VERIFIED session, never an id taken from a form.

const KNOWN_CODES = [
  "bad_target",
  "target_not_found",
  "conversation_not_found",
  "bad_reason",
  "bad_details",
  "bad_attach",
  "bad_note",
  "rate_limited",
  "not_kept",
  "not_admin",
  "report_not_found",
  "already_resolved",
  "already_acknowledged",
  "cannot_suspend",
  "target_gone",
  "not_suspended",
  "not_open",
  "bad_action",
  "bad_message",
  "bad_kind",
  "bad_version",
  "cannot_withdraw",
  "use_verification_form",
  "not_found",
  "admin_account",
  "bad_secret",
] as const;

// Turns a database error message into one of the short codes, or null for a
// real failure. Whole codes only ("not_open" must not match "decision_not_open").
export function safetyErrorCode(
  message: string | undefined | null,
): string | null {
  if (!message) return null;
  return (
    KNOWN_CODES.find((code) =>
      new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`).test(message),
    ) ?? null
  );
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; code: string };

// Runs one rpc and returns either its value or a short error code. A failure
// without a known code comes back as "failed".
export async function callDb<T>(
  service: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<Outcome<T>> {
  const { data, error } = await service.rpc(fn, args);
  if (error) {
    return { ok: false, code: safetyErrorCode(error.message) ?? "failed" };
  }
  return { ok: true, value: data as T };
}

export function blockUserInDb(
  service: SupabaseClient,
  args: { blockerId: string; targetId: string },
) {
  return callDb<{ already: boolean; ended: number; freed_user_ids: string[] }>(
    service,
    "block_user",
    {
      p_blocker: args.blockerId,
      p_target: args.targetId,
      p_now: new Date().toISOString(),
      p_max_per_day: SAFETY_CONFIG.maxBlocksPerDay,
    },
  );
}

export function reportUserInDb(
  service: SupabaseClient,
  args: {
    reporterId: string;
    targetId: string;
    conversationId: string | null;
    reason: string;
    details: string | null;
    attach: boolean;
  },
) {
  return callDb<{ id: string; status: string; evidence_count: number }>(
    service,
    "report_user",
    {
      p_reporter: args.reporterId,
      p_target: args.targetId,
      p_conversation: args.conversationId,
      p_reason: args.reason,
      p_details: args.details,
      p_attach: args.attach,
      p_now: new Date().toISOString(),
      p_max_per_day: SAFETY_CONFIG.maxReportsPerDay,
      p_max_evidence: SAFETY_CONFIG.maxEvidenceMessages,
    },
  );
}

export function endKeptChatInDb(
  service: SupabaseClient,
  args: { userId: string; conversationId: string; note: string | null },
) {
  return callDb<{ other_id: string }>(service, "end_kept_conversation", {
    p_user: args.userId,
    p_conversation: args.conversationId,
    p_note: args.note,
    p_now: new Date().toISOString(),
  });
}

export function resolveReportInDb(
  service: SupabaseClient,
  args: {
    adminId: string;
    reportId: string;
    action: "ack" | "action" | "dismiss";
    note: string | null;
    suspend: boolean;
  },
) {
  return callDb<{
    status: string;
    suspended: boolean;
    freed_user_ids: string[];
  }>(service, "admin_resolve_report", {
    p_admin: args.adminId,
    p_report: args.reportId,
    p_action: args.action,
    p_note: args.note,
    p_suspend: args.suspend,
    p_now: new Date().toISOString(),
  });
}

export type ReportDetail = {
  id: string;
  reason: string;
  details: string | null;
  status: "open" | "ack" | "actioned" | "dismissed";
  created_at: string;
  ack_at: string | null;
  resolved_at: string | null;
  admin_note: string | null;
  reporter_id: string | null;
  reporter_name: string | null;
  target_id: string | null;
  target_name: string | null;
  target_suspended: boolean;
  other_reports_about_target: number;
  has_evidence: boolean;
  evidence:
    { at: string; from: "reporter" | "reported"; body: string }[] | null;
};

export function getReportInDb(
  service: SupabaseClient,
  args: { adminId: string; reportId: string; withEvidence: boolean },
) {
  return callDb<ReportDetail>(service, "admin_get_report", {
    p_admin: args.adminId,
    p_report: args.reportId,
    p_with_evidence: args.withEvidence,
    p_now: new Date().toISOString(),
  });
}

export function unsuspendInDb(
  service: SupabaseClient,
  args: { adminId: string; targetId: string },
) {
  return callDb<null>(service, "admin_unsuspend_user", {
    p_admin: args.adminId,
    p_target: args.targetId,
    p_now: new Date().toISOString(),
  });
}

// Plain-language text for each error the screens can show.
export const SAFETY_ERROR_TEXT: Record<string, string> = {
  rate_limited:
    "You have done this several times today already. Please try again tomorrow, or use the contact page if it is urgent.",
  target_not_found: "We could not find that person.",
  conversation_not_found: "We could not find that chat.",
  bad_details: "Please keep the details to 1000 characters of plain text.",
  bad_reason: "Please pick a reason.",
  not_kept: "Only a chat you both kept can be ended this way.",
  bad_target: "We could not do that.",
};

export function safetyErrorText(code: string): string {
  return SAFETY_ERROR_TEXT[code] ?? "Something went wrong. Please try again.";
}
