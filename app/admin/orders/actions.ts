"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdmin } from "@/lib/admin/require-admin";
import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";

// Take Plus away from the member behind an order (for example after a refund
// made by hand in the payment provider's dashboard). The admin is re-checked
// here on every call, and the database function checks again and writes the
// audit row in the same transaction. No refund is sent from here: this app
// never moves money back.
export async function revokePlusAction(form: FormData) {
  const parsed = z.object({ orderId: z.uuid() }).safeParse({
    orderId: form.get("orderId"),
  });
  if (!parsed.success) redirect("/admin/orders?result=invalid");

  const admin = await getAdmin();
  if (!admin) redirect("/admin/orders?result=forbidden");
  const service = createAdminClient();
  if (!service) redirect("/admin/orders?result=failed");

  const { data: order } = await service
    .from("orders")
    .select("user_id")
    .eq("id", parsed.data.orderId)
    .maybeSingle();
  if (!order?.user_id) redirect("/admin/orders?result=invalid");

  const { error } = await service.rpc("revoke_plus", {
    p_admin: admin.adminId,
    p_target: order.user_id,
  });
  if (error) {
    redirect(
      `/admin/orders?result=${error.message.includes("not_plus") ? "not_plus" : "failed"}`,
    );
  }
  await logEvent("plus_revoked", order.user_id, { by: "admin" });
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  redirect("/admin/orders?result=revoked");
}
