import type { WebhookEvent } from "./types";

// Reads the body of a Razorpay webhook. The simulated provider sends the same
// shape, so one parser serves both. It is defensive: anything unexpected gives
// null (the endpoint answers 200 and ignores it), never an exception.
//
// The events we act on:
//   payment.captured  the money was taken
//   order.paid        the order is fully paid (also carries the payment)
//   payment.failed    an attempt failed (the customer may try again)

type Entity = Record<string, unknown>;

function entity(payload: unknown, key: "payment" | "order"): Entity | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = (payload as Record<string, unknown>)[key];
  if (!wrapper || typeof wrapper !== "object") return null;
  const e = (wrapper as Record<string, unknown>).entity;
  return e && typeof e === "object" ? (e as Entity) : null;
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

export function parseRazorpayWebhook(rawBody: string): WebhookEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const event = (body as Record<string, unknown>).event;
  const payload = (body as Record<string, unknown>).payload;

  const payment = entity(payload, "payment");
  const order = entity(payload, "order");

  if (event === "payment.captured" || event === "order.paid") {
    const orderId = str(payment?.order_id) ?? str(order?.id);
    const paymentId = str(payment?.id);
    // For order.paid the order's own amount is what was asked; for
    // payment.captured it is the payment's amount.
    const amount = int(payment?.amount) ?? int(order?.amount_paid);
    const currency = str(payment?.currency) ?? str(order?.currency);
    if (!orderId || !paymentId || amount === null || !currency) return null;
    if (
      payment &&
      payment.status !== undefined &&
      payment.status !== "captured"
    )
      return null;
    return {
      kind: "paid",
      orderId,
      paymentId,
      amountPaise: amount,
      currency,
    };
  }

  if (event === "payment.failed") {
    const orderId = str(payment?.order_id);
    if (!orderId) return null;
    return {
      kind: "failed",
      orderId,
      paymentId: str(payment?.id),
      reason: str(payment?.error_description)?.slice(0, 200) ?? null,
    };
  }
  return null;
}
