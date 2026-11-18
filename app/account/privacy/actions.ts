"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { POLICY_VERSION } from "@/lib/consent";
import { logEvent } from "@/lib/events";
import { callDb } from "@/lib/safety/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Giving and withdrawing consents. The person comes from the session; the
// database function set_consent() decides which kinds may change and, when
// eLitmus sharing is withdrawn, unlinks the verification in the same step.

const schema = z.object({
  kind: z.enum(["marketing", "elitmus_data_sharing"]),
  granted: z.enum(["true", "false"]),
});

async function who() {
  const supabase = await createClient();
  const service = createAdminClient();
  if (!supabase || !service) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ? { service, userId: data.user.id } : null;
}

export async function setConsentAction(form: FormData) {
  const parsed = schema.safeParse({
    kind: form.get("kind"),
    granted: form.get("granted"),
  });
  if (!parsed.success) redirect("/account/privacy?result=invalid");
  const session = await who();
  if (!session) redirect("/login?next=/account/privacy");

  const granted = parsed.data.granted === "true";
  const result = await callDb<{ changed: boolean }>(
    session.service,
    "set_consent",
    {
      p_user: session.userId,
      p_kind: parsed.data.kind,
      p_granted: granted,
      p_version: POLICY_VERSION,
      p_now: new Date().toISOString(),
    },
  );
  if (!result.ok) redirect("/account/privacy?result=failed");

  await logEvent(
    granted ? "consent_given" : "consent_withdrawn",
    session.userId,
    {
      kind: parsed.data.kind,
    },
  );
  revalidatePath("/account/privacy");
  revalidatePath("/account/profile");
  redirect(
    `/account/privacy?result=${granted ? "given" : "withdrawn"}&kind=${parsed.data.kind}`,
  );
}

// "I have read the updated Terms and Privacy Notice."
export async function acceptPolicyUpdateAction() {
  const session = await who();
  if (!session) redirect("/login?next=/account/privacy");
  for (const kind of ["terms", "privacy"] as const) {
    const result = await callDb(session.service, "set_consent", {
      p_user: session.userId,
      p_kind: kind,
      p_granted: true,
      p_version: POLICY_VERSION,
      p_now: new Date().toISOString(),
    });
    if (!result.ok) redirect("/account/privacy?result=failed");
  }
  await logEvent("policy_update_accepted", session.userId);
  revalidatePath("/account/privacy");
  redirect("/account/privacy?result=accepted");
}
