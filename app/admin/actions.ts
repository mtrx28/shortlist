"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdmin } from "@/lib/admin/require-admin";
import { reviewResultFromError } from "@/lib/admin/review";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";

// Approve or reject a pending eLitmus verification request.
//
// Admins have no database permission to change elitmus_status, so the change
// is made with the service role. That makes these checks important:
//   * the caller is re-checked as an admin here, on every call (a server
//     action is a public endpoint; the page being hidden is not protection);
//   * the database function admin_review_verification() checks again that the
//     admin is an admin and that the row is still "pending", then changes the
//     status and writes the audit_log row in ONE transaction, so there is
//     never a change without a record, or a record without a change.

const formSchema = z.object({ userId: z.string().uuid() });

type Decision = "approve" | "reject";

async function review(form: FormData, decision: Decision) {
  const parsed = formSchema.safeParse({ userId: form.get("userId") });
  if (!parsed.success) redirect("/admin/verifications?result=invalid");

  const admin = await getAdmin();
  if (!admin) redirect("/admin/verifications?result=forbidden");

  const service = createAdminClient();
  if (!service) redirect("/admin/verifications?result=failed");

  const targetId = parsed.data.userId;
  const { error } = await service.rpc("admin_review_verification", {
    p_admin: admin.adminId,
    p_target: targetId,
    p_decision: decision,
  });
  if (error) {
    redirect(
      `/admin/verifications?result=${reviewResultFromError(error.message)}`,
    );
  }

  await logEvent(
    decision === "approve" ? "verification_approved" : "verification_rejected",
    targetId,
    { by: "admin" },
  );
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
