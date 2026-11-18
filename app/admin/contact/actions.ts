"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdmin } from "@/lib/admin/require-admin";
import { callDb } from "@/lib/safety/service";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ id: z.uuid() });

export async function markContactHandledAction(form: FormData) {
  const parsed = schema.safeParse({ id: form.get("id") });
  if (!parsed.success) redirect("/admin/contact?result=failed");
  const admin = await getAdmin();
  if (!admin) redirect("/admin/contact?result=failed");
  const service = createAdminClient();
  if (!service) redirect("/admin/contact?result=failed");

  const result = await callDb(service, "admin_mark_contact_handled", {
    p_admin: admin.adminId,
    p_message: parsed.data.id,
    p_now: new Date().toISOString(),
  });
  revalidatePath("/admin/contact");
  revalidatePath("/admin");
  redirect(`/admin/contact?result=${result.ok ? "handled" : "failed"}`);
}
