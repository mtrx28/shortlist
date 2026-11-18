import { NextResponse } from "next/server";
import { applyWebhook } from "@/lib/payments/service";
import { getPaymentProvider } from "@/lib/payments/select";
import { createAdminClient } from "@/lib/supabase/admin";

// Always run on request; never cache.
export const dynamic = "force-dynamic";

// Razorpay (or the simulated provider) calls this when a payment succeeds or
// fails. It is the source of truth: it still works if the member closes the
// browser tab right after paying.
//
// The signature is checked over the RAW body text, so the body is read as text
// here and parsed only afterwards. Answers:
//   400  signature missing or wrong (the sender may retry; nothing happened)
//   200  handled, or a genuine event that needs no action. Replaying the same
//        event is safe: it answers 200 again and changes nothing.
//   500  our database failed; the provider will try again later.
//   503  payments are not configured on this server.
// The middleware skips this path: there is no login here, only the signature.
export async function POST(request: Request) {
  const db = createAdminClient();
  if (!db) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  let provider;
  try {
    provider = getPaymentProvider();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  // An absurdly large body is not a webhook.
  if (rawBody.length > 100_000) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }

  const outcome = await applyWebhook({
    db,
    provider,
    rawBody,
    signature: request.headers.get("x-razorpay-signature"),
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
