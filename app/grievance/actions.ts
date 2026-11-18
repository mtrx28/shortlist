"use server";

import { createHash } from "node:crypto";
import { SAFETY_CONFIG } from "@/config/safety";
import { logEvent } from "@/lib/events";
import { callDb } from "@/lib/safety/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { contactSchema } from "@/lib/validators/safety";
import { toFormState, type FormState } from "@/lib/validators/auth";

// The "contact us" form. Anyone can use it, signed in or not, so the limits
// matter: a few messages per sender per day (counted by a hash of the email)
// and a ceiling for everybody, both counted by the database.

export async function contactAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = contactSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    message: form.get("message"),
  });
  if (!parsed.success) return toFormState(parsed.error);

  const service = createAdminClient();
  if (!service) return { error: "This server is not set up yet." };

  // If signed in, remember who (so the export can include it).
  let userId: string | null = null;
  const supabase = await createClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  }

  const email = parsed.data.email.toLowerCase();
  const senderKey = createHash("sha256")
    .update("contact:" + email)
    .digest("hex");

  const result = await callDb(service, "submit_contact_message", {
    p_user: userId,
    p_name: parsed.data.name,
    p_email: email,
    p_message: parsed.data.message,
    p_sender_key: senderKey,
    p_now: new Date().toISOString(),
    p_per_sender_per_day: SAFETY_CONFIG.contactPerSenderPerDay,
    p_global_per_day: SAFETY_CONFIG.contactGlobalPerDay,
  });
  if (!result.ok) {
    if (result.code === "rate_limited") {
      return {
        error:
          "We have already received several messages from you today. Please wait a day, or email the grievance officer directly.",
      };
    }
    return { error: "We could not send that. Please try again." };
  }

  await logEvent("contact_message", userId);
  return {
    message:
      "Thank you. We have your message and will acknowledge it within 24 hours at the email you gave.",
  };
}
