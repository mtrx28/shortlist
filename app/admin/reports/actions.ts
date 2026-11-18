"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdmin } from "@/lib/admin/require-admin";
import { retryAfterSlotsFreed } from "@/lib/conversation/after-close";
import { logEvent } from "@/lib/events";
import { resolveReportInDb, unsuspendInDb } from "@/lib/safety/service";
import { createAdminClient } from "@/lib/supabase/admin";

// Moderation actions. Like every admin action: a server action is a public
// endpoint, so the caller is re-checked as an admin here, and the database
// function checks again and writes the audit rows in the same transaction as
// the change.

const resolveSchema = z.object({
  reportId: z.uuid(),
  action: z.enum(["ack", "action", "dismiss"]),
  note: z.string().max(1000).optional(),
  suspend: z.string().optional(),
});

const RESULT_BY_CODE: Record<string, string> = {
  already_resolved: "already_resolved",
  already_acknowledged: "already_acknowledged",
  report_not_found: "not_found",
  cannot_suspend: "cannot_suspend",
  target_gone: "target_gone",
  not_admin: "forbidden",
  bad_note: "bad_note",
};

export async function resolveReportAction(form: FormData) {
  const parsed = resolveSchema.safeParse({
    reportId: form.get("reportId"),
    action: form.get("action"),
    note: form.get("note") ?? undefined,
    suspend: form.get("suspend") ?? undefined,
  });
  if (!parsed.success) redirect("/admin/reports?result=invalid");
  const { reportId, action } = parsed.data;
  const back = `/admin/reports/${reportId}`;

  const admin = await getAdmin();
  if (!admin) redirect(`${back}?result=forbidden`);
  const service = createAdminClient();
  if (!service) redirect(`${back}?result=failed`);

  const suspend = action === "action" && parsed.data.suspend === "on";
  const result = await resolveReportInDb(service, {
    adminId: admin.adminId,
    reportId,
    action,
    note: parsed.data.note?.trim() || null,
    suspend,
  });
  if (!result.ok) {
    redirect(`${back}?result=${RESULT_BY_CODE[result.code] ?? "failed"}`);
  }

  await logEvent(`report_${result.value.status}`, null, { by: "admin" });
  if (result.value.suspended) {
    // Their chats ended, so the other people's slots are free again.
    await retryAfterSlotsFreed(service, result.value.freed_user_ids);
  }
  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  redirect(
    `${back}?result=${result.value.suspended ? "suspended" : result.value.status}`,
  );
}

const unsuspendSchema = z.object({
  targetId: z.uuid(),
  reportId: z.uuid(),
});

export async function unsuspendAction(form: FormData) {
  const parsed = unsuspendSchema.safeParse({
    targetId: form.get("targetId"),
    reportId: form.get("reportId"),
  });
  if (!parsed.success) redirect("/admin/reports?result=invalid");
  const back = `/admin/reports/${parsed.data.reportId}`;
  const admin = await getAdmin();
  if (!admin) redirect(`${back}?result=forbidden`);
  const service = createAdminClient();
  if (!service) redirect(`${back}?result=failed`);

  const result = await unsuspendInDb(service, {
    adminId: admin.adminId,
    targetId: parsed.data.targetId,
  });
  if (!result.ok) redirect(`${back}?result=failed`);
  revalidatePath("/admin/reports");
  redirect(`${back}?result=unsuspended`);
}
