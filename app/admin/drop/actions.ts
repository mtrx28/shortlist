"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { runDropJob } from "@/lib/matching/drop-job";
import { createAdminClient } from "@/lib/supabase/admin";

// "Run drop now". A server action is a public endpoint, so the admin check is
// repeated here and does not rely on the page being hidden.
// The matching itself needs the service role (it reads every profile).
export async function runDropAction(form: FormData) {
  const { adminId } = await requireAdmin();

  const service = createAdminClient();
  if (!service) redirect("/admin/drop?result=not_configured");

  // Only replaces this week's drop if nobody has answered an intro yet.
  const rebuild = form.get("rebuild") === "on";

  let result: string;
  try {
    const outcome = await runDropJob(service, {
      adminId,
      rebuild,
      source: "admin",
    });
    result = outcome.status;
  } catch (error) {
    console.error(
      "run drop failed",
      error instanceof Error ? error.message : error,
    );
    result = "failed";
  }

  revalidatePath("/admin/drop");
  revalidatePath("/admin");
  redirect(`/admin/drop?result=${result}`);
}
