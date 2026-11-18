"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAYMENT_LIMITS } from "@/config/plans";
import { demoControlsEnabled } from "@/lib/conversation/demo";
import { logEvent } from "@/lib/events";
import { PaymentConfigError, getPaymentProvider } from "@/lib/payments/select";
import { confirmPayment, createPlusOrder } from "@/lib/payments/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The browser's side of buying Plus. A server action is a public endpoint, so
// each one checks who is signed in (from the session, never from the form),
// validates its input, and leaves the money decisions to the server code in
// lib/payments/. The browser can say WHICH plan to buy; it can never say what
// it costs or that it has paid.

type Buyer = { userId: string };

async function currentBuyer(): Promise<Buyer | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("suspended_at, deleted_at")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || profile.suspended_at || profile.deleted_at) return null;
  return { userId: data.user.id };
}

function providerOrNull() {
  try {
    return getPaymentProvider();
  } catch (e) {
    if (e instanceof PaymentConfigError) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 1. Create an order
// ---------------------------------------------------------------------------
export type StartResult =
  | {
      ok: true;
      provider: "razorpay";
      keyId: string;
      providerOrderId: string;
      amountPaise: number;
      currency: string;
    }
  | { ok: true; provider: "simulated"; checkoutPath: string }
  | { ok: false; error: string };

export async function startCheckoutAction(plan: string): Promise<StartResult> {
  const buyer = await currentBuyer();
  if (!buyer) return { ok: false, error: "Please log in again." };
  const db = createAdminClient();
  const provider = providerOrNull();
  if (!db || !provider) {
    return { ok: false, error: "Payments are not set up on this server." };
  }

  const order = await createPlusOrder({
    db,
    provider,
    userId: buyer.userId,
    planId: plan,
  });
  if (!order.ok) {
    return {
      ok: false,
      error:
        order.reason === "rate_limited"
          ? "You have started several checkouts in the last hour. Please wait a little before trying again."
          : order.reason === "invalid_plan"
            ? "That plan does not exist."
            : "We could not start the payment. Nothing was charged. Please try again.",
    };
  }

  if (provider.name === "simulated") {
    return {
      ok: true,
      provider: "simulated",
      checkoutPath: `/plus/checkout/${order.orderId}`,
    };
  }
  return {
    ok: true,
    provider: "razorpay",
    keyId: provider.publicConfig().keyId ?? "",
    providerOrderId: order.providerOrderId,
    amountPaise: order.amountPaise,
    currency: order.currency,
  };
}

// ---------------------------------------------------------------------------
// 2. The payment came back from the checkout window
// ---------------------------------------------------------------------------
const idSchema = z
  .string()
  .min(5)
  .max(80)
  .regex(/^[A-Za-z0-9_]+$/);
const confirmSchema = z.object({
  providerOrderId: idSchema,
  paymentId: idSchema,
  signature: z.string().min(10).max(200),
});

export type FinishResult = { ok: boolean; redirectTo: string };

export async function confirmPaymentAction(input: {
  providerOrderId: string;
  paymentId: string;
  signature: string;
}): Promise<FinishResult> {
  const failed = (why: string): FinishResult => ({
    ok: false,
    redirectTo: `/plus/failed?why=${why}`,
  });
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return failed("invalid");
  const buyer = await currentBuyer();
  const db = createAdminClient();
  const provider = providerOrNull();
  if (!buyer || !db || !provider) return failed("unavailable");

  const result = await confirmPayment({
    db,
    provider,
    userId: buyer.userId,
    ...parsed.data,
  });
  if (!result.ok) {
    return failed(
      result.reason === "bad_signature"
        ? "signature"
        : result.reason === "rejected"
          ? "rejected"
          : "unavailable",
    );
  }

  // Which of the member's orders is it? (for the success page)
  const { data: order } = await db
    .from("orders")
    .select("id")
    .eq("razorpay_order_id", parsed.data.providerOrderId)
    .eq("user_id", buyer.userId)
    .maybeSingle();
  for (const p of ["/plus", "/shortlist", "/chat", "/home"]) revalidatePath(p);
  return {
    ok: true,
    redirectTo: order ? `/plus/success?order=${order.id}` : "/plus/success",
  };
}

// ---------------------------------------------------------------------------
// 3. The member cancelled or the payment failed in the checkout window
// ---------------------------------------------------------------------------
export async function failPaymentAction(input: {
  providerOrderId: string;
  reason?: string;
}): Promise<FinishResult> {
  const parsed = z
    .object({
      providerOrderId: idSchema,
      reason: z.string().max(200).optional(),
    })
    .safeParse(input);
  const buyer = await currentBuyer();
  const db = createAdminClient();
  if (parsed.success && buyer && db) {
    // Only marks an order of this member that is still waiting. A later
    // successful payment on the same order still works.
    await db.rpc("fail_order", {
      p_provider_order_id: parsed.data.providerOrderId,
      p_expected_user: buyer.userId,
      p_reason: parsed.data.reason ?? null,
    });
    await logEvent("plus_payment_failed", buyer.userId);
  }
  return { ok: false, redirectTo: "/plus/failed?why=failed" };
}

// ---------------------------------------------------------------------------
// 4. Demo helper: "give me 30 days of Plus" for demo accounts only
// ---------------------------------------------------------------------------
// Three locks, like the chat demo controls: DEMO_CONTROLS=true on the server,
// the account is a demo account (app_metadata.demo, set only by the seed
// script), and the caller is that account. Real members never get this.
export async function demoGrantPlusAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!demoControlsEnabled()) {
    return { ok: false, message: "Demo controls are off on this server." };
  }
  const buyer = await currentBuyer();
  const db = createAdminClient();
  if (!buyer || !db) return { ok: false, message: "Please log in again." };
  const { data: found } = await db.auth.admin.getUserById(buyer.userId);
  if (found.user?.app_metadata?.demo !== true) {
    return { ok: false, message: "This is only for the demo accounts." };
  }
  const { error } = await db.rpc("grant_demo_plus", {
    p_user: buyer.userId,
    p_days: PAYMENT_LIMITS.demoGrantDays,
  });
  if (error) return { ok: false, message: "That did not work. Try again." };
  for (const p of ["/plus", "/shortlist", "/chat", "/home"]) revalidatePath(p);
  return {
    ok: true,
    message: `Plus switched on for ${PAYMENT_LIMITS.demoGrantDays} more days (demo only, nothing was paid).`,
  };
}
