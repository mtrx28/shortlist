// "Run the drop" as the app does it: run it, then leave a trace. Both the cron
// endpoint and the admin button call this, so they behave the same.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAuditEntry } from "@/lib/admin/audit";
import { logEvent } from "@/lib/events";
import { runDrop, type RunDropOutcome, type RunDropOptions } from "./run-drop";
import { SupabaseDropStore } from "./supabase-store";

export async function runDropJob(
  service: SupabaseClient,
  options: RunDropOptions & { adminId?: string } = {},
): Promise<RunDropOutcome> {
  const source = options.source ?? (options.adminId ? "admin" : "cron");
  const outcome = await runDrop(new SupabaseDropStore(service), {
    ...options,
    source,
  });

  // An event for the stats screen. Numbers and words only, no personal data.
  await logEvent("drop_run", null, {
    source,
    status: outcome.status,
    week: outcome.weekStart,
    eligible: outcome.stats?.usersEligible ?? 0,
    intros: outcome.stats?.introsCreated ?? 0,
  });

  // An admin pressing the button is recorded in the audit log, with who.
  if (options.adminId && outcome.dropId) {
    await service.from("audit_log").insert(
      buildAuditEntry({
        adminId: options.adminId,
        action: "drop_run",
        targetType: "drop",
        targetId: outcome.dropId,
      }),
    );
  }
  return outcome;
}
