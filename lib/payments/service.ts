import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CURRENCY,
  PAYMENT_LIMITS,
  PLANS,
  isPlanId,
  type PlanId,
} from "@/config/plans";
import { logEvent } from "@/lib/events";
import type { PaymentProvider, WebhookEvent } from "./types";

// The server side of buying Plus. Every function takes the database client and
// the provider as arguments, so it can be tested without a network.
//
// The rules, in plain words:
//   * The price comes from config/plans.ts. The browser only says WHICH plan.
//   * The member's id comes from their verified session, never from the form.
//   * Plus is granted by one database function, grant_plus(), which is safe to
//     call twice. Two doors lead to it: the browser callback (confirmPayment)
//     and the provider's webhook (applyWebhook). Whichever comes first wins and
//     the other is a no-op.

// ---------------------------------------------------------------------------
// Creating an order
// ---------------------------------------------------------------------------
export type CreateOrderResult =
  | {
      ok: true;
      orderId: string; // our own id for the order row
      providerOrderId: string;
      amountPaise: number;
      currency: string;
    }
  | { ok: false; reason: "invalid_plan" | "rate_limited" | "failed" };

export async function createPlusOrder(args: {
  db: SupabaseClient;
  provider: PaymentProvider;
  userId: string;
  planId: unknown;
  now?: Date;
}): Promise<CreateOrderResult> {
  const { db, provider, userId } = args;
  const now = args.now ?? new Date();
  if (!isPlanId(args.planId)) return { ok: false, reason: "invalid_plan" };
  const plan = PLANS[args.planId as PlanId];

  // At most a few new orders an hour per person (counted in the database).
  const since = new Date(now.getTime() - 3600 * 1000).toISOString();
  const { count, error: countError } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (countError) return { ok: false, reason: "failed" };
  if ((count ?? 0) >= PAYMENT_LIMITS.ordersPerHour) {
    return { ok: false, reason: "rate_limited" };
  }

  let providerOrder;
  try {
    providerOrder = await provider.createOrder({
      amountPaise: plan.amountPaise,
      currency: CURRENCY,
      // Our reference. No name or email goes to the provider.
      receipt: `plus_${userId.slice(0, 8)}_${now.getTime()}`,
      notes: { plan: plan.id },
    });
  } catch {
    return { ok: false, reason: "failed" };
  }

  const { data, error } = await db
    .from("orders")
    .insert({
      user_id: userId,
      razorpay_order_id: providerOrder.id,
      plan: plan.id,
      amount_paise: plan.amountPaise,
      currency: CURRENCY,
      days: plan.days,
      provider: provider.name,
      status: "created",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, reason: "failed" };

  await logEvent("plus_checkout_started", userId, {
    plan: plan.id,
    provider: provider.name,
  });
  return {
    ok: true,
    orderId: data.id as string,
    providerOrderId: providerOrder.id,
    amountPaise: plan.amountPaise,
    currency: CURRENCY,
  };
}

// ---------------------------------------------------------------------------
// Granting (shared by the callback and the webhook)
// ---------------------------------------------------------------------------
export type GrantResult =
  | "granted"
  | "already_granted"
  | "not_found"
  | "wrong_user"
  | "amount_mismatch"
  | "currency_mismatch"
  | "payment_conflict"
  | "order_orphaned";

const GRANT_RESULTS: GrantResult[] = [
  "granted",
  "already_granted",
  "not_found",
  "wrong_user",
  "amount_mismatch",
  "currency_mismatch",
  "payment_conflict",
  "order_orphaned",
];

export async function grantPlus(
  db: SupabaseClient,
  args: {
    providerOrderId: string;
    paymentId: string;
    amountPaise?: number;
    currency?: string;
    expectedUser?: string;
    source: "callback" | "webhook";
    now?: Date;
  },
): Promise<{ result: GrantResult; plusUntil: string | null } | null> {
  const { data, error } = await db.rpc("grant_plus", {
    p_provider_order_id: args.providerOrderId,
    p_payment_id: args.paymentId,
    p_amount_paise: args.amountPaise ?? null,
    p_currency: args.currency ?? null,
    p_expected_user: args.expectedUser ?? null,
    p_source: args.source,
    ...(args.now ? { p_now: args.now.toISOString() } : {}),
  });
  if (error || !data) return null;
  const row = data as { result?: string; plus_until?: string | null };
  const result = GRANT_RESULTS.find((r) => r === row.result);
  if (!result) return null;
  return { result, plusUntil: row.plus_until ?? null };
}

// ---------------------------------------------------------------------------
// The browser callback
// ---------------------------------------------------------------------------
export type ConfirmResult =
  | { ok: true; alreadyGranted: boolean; plusUntil: string | null }
  | { ok: false; reason: "bad_signature" | "rejected" | "failed" };

export async function confirmPayment(args: {
  db: SupabaseClient;
  provider: PaymentProvider;
  userId: string;
  providerOrderId: string;
  paymentId: string;
  signature: string;
  now?: Date;
}): Promise<ConfirmResult> {
  const { db, provider, userId } = args;

  // 1. Is the callback genuine? Without the provider's secret nobody can make
  //    a signature that passes.
  const genuine = provider.verifyPayment({
    orderId: args.providerOrderId,
    paymentId: args.paymentId,
    signature: args.signature,
  });
  if (!genuine) {
    await logEvent("payment_signature_rejected", userId, { via: "callback" });
    return { ok: false, reason: "bad_signature" };
  }

  // 2. Is it our order, this member's, and the right amount? grant_plus checks
  //    ownership and the database holds the amount, so a genuine payment for
  //    somebody else's order cannot be claimed.
  const granted = await grantPlus(db, {
    providerOrderId: args.providerOrderId,
    paymentId: args.paymentId,
    expectedUser: userId,
    source: "callback",
    now: args.now,
  });
  if (!granted) return { ok: false, reason: "failed" };
  if (granted.result === "granted" || granted.result === "already_granted") {
    return {
      ok: true,
      alreadyGranted: granted.result === "already_granted",
      plusUntil: granted.plusUntil,
    };
  }
  await logEvent("payment_rejected", userId, {
    via: "callback",
    why: granted.result,
  });
  return { ok: false, reason: "rejected" };
}

// ---------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------
export type WebhookOutcome =
  | { status: 200; body: { result: string } }
  | { status: 400 | 500 | 503; body: { error: string } };

// `rawBody` is the exact text received. The signature is checked on THAT text
// before anything is parsed.
export async function applyWebhook(args: {
  db: SupabaseClient;
  provider: PaymentProvider;
  rawBody: string;
  signature: string | null;
}): Promise<WebhookOutcome> {
  const { db, provider, rawBody, signature } = args;

  if (!provider.verifyWebhook(rawBody, signature)) {
    return { status: 400, body: { error: "invalid_signature" } };
  }
  const event: WebhookEvent | null = provider.parseWebhook(rawBody);
  // A genuine event we do not use (refunds, settlements...). Answer 200 so the
  // provider does not retry it.
  if (!event) return { status: 200, body: { result: "ignored" } };

  if (event.kind === "failed") {
    await db.rpc("fail_order", {
      p_provider_order_id: event.orderId,
      p_expected_user: null,
      p_reason: event.reason,
    });
    return { status: 200, body: { result: "failure_noted" } };
  }

  const granted = await grantPlus(db, {
    providerOrderId: event.orderId,
    paymentId: event.paymentId,
    amountPaise: event.amountPaise,
    currency: event.currency,
    source: "webhook",
  });
  // A database error: answer 500 so the provider tries again later.
  if (!granted) return { status: 500, body: { error: "try_again" } };

  if (granted.result === "granted" || granted.result === "already_granted") {
    return { status: 200, body: { result: granted.result } };
  }
  // The event is genuine but does not match any order of ours (or does not
  // match its amount). Nothing is granted. Answer 200: retrying cannot fix it.
  await logEvent("payment_rejected", null, {
    via: "webhook",
    why: granted.result,
  });
  return { status: 200, body: { result: granted.result } };
}
