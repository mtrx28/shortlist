"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { buildAuditEntry, type AuditAction } from "@/lib/admin/audit";
import { getAdmin } from "@/lib/admin/require-admin";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";

// Approve or reject a pending eLitmus verification request.
//
// Admins have no database permission to change elitmus_status, so the change
// is made with the service role. That makes these checks important:
//   * the caller is re-checked as an admin here, on every call (a server
//     action is a public endpoint; the page being hidden is not protection);
//   * only rows that are still "pending" can change, so a double click or a
//     stale page does nothing;
//   * every change is written to audit_log with the admin's id.

const formSchema = z.object({ userId: z.string().uuid() });

type Decision = "approve" | "reject";

async function review(form: FormData, decision: Decision) {
  const parsed = formSchema.safeParse({ userId: form.get("userId") });
  if (!parsed.success) redirect("/admin/verifications?result=invalid");

  const admin = await getAdmin();
  if (!admin) redirect("/admin/verifications?result=forbidden");

  const service = createAdminClient();
  if (!service) redirect("/admin/verifications?result=failed");

  const action: AuditAction =
    decision === "approve" ? "verification_approved" : "verification_rejected";
  const targetId = parsed.data.userId;

  // The audit row goes in first, so there is never a change without a record.
  // PostgREST cannot wrap two statements in one transaction; if the change
  // then fails, the row is removed again.
  const { data: audit, error: auditError } = await service
    .from("audit_log")
    .insert(
      buildAuditEntry({
        adminId: admin.adminId,
        action,
        targetType: "profile",
        targetId,
      }),
    )
    .select("id")
    .single();
  if (auditError || !audit) redirect("/admin/verifications?result=failed");

  // Approve keeps the pH ID hash. Reject goes back to "none" and clears the
  // hash, so the person can try again with the right ID (the hash is unique
  // per account and would otherwise block it).
  const changes =
    decision === "approve"
      ? { elitmus_status: "verified" }
      : { elitmus_status: "none", elitmus_ref_hash: null };

  const { data: changed, error } = await service
    .from("profiles")
    .update(changes)
    .eq("id", targetId)
    .eq("elitmus_status", "pending")
    .select("id");

  if (error || !changed || changed.length === 0) {
    await service.from("audit_log").delete().eq("id", audit.id);
    redirect(
      `/admin/verifications?result=${error ? "failed" : "already_handled"}`,
    );
  }

  await logEvent(action, targetId, { by: "admin" });
  revalidatePath("/admin/verifications");
  revalidatePath("/admin");
  redirect(
    `/admin/verifications?result=${decision === "approve" ? "approved" : "rejected"}`,
  );
}

export async function approveVerificationAction(form: FormData) {
  await review(form, "approve");
}

export async function rejectVerificationAction(form: FormData) {
  await review(form, "reject");
}
