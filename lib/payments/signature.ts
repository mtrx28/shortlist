import { createHmac, timingSafeEqual } from "node:crypto";

// Signature checks for payments. Razorpay signs two things with HMAC-SHA256
// (a keyed fingerprint only someone who knows the secret can produce):
//
//   * the browser callback after a payment: HMAC(order_id + "|" + payment_id)
//     using the account's KEY SECRET;
//   * a webhook: HMAC(the raw request body) using the WEBHOOK SECRET.
//
// We never trust "I paid" from a browser. We recompute the fingerprint here and
// compare. The comparison is constant-time so response speed cannot be used to
// guess a signature one character at a time.

export function hmacSha256Hex(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

// Compares two hex strings without leaking where they first differ. Anything
// that is not the same length or not hex is simply "not equal".
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  return timingSafeEqual(
    Buffer.from(a.toLowerCase(), "hex"),
    Buffer.from(b.toLowerCase(), "hex"),
  );
}

export function paymentSignature(
  orderId: string,
  paymentId: string,
  keySecret: string,
): string {
  return hmacSha256Hex(`${orderId}|${paymentId}`, keySecret);
}

export function verifyPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  if (!args.orderId || !args.paymentId || !args.keySecret) return false;
  // Ids come from the browser; a "|" inside one could shift the boundary
  // between the two parts, so such ids are refused outright.
  if (args.orderId.includes("|") || args.paymentId.includes("|")) return false;
  return safeEqualHex(
    paymentSignature(args.orderId, args.paymentId, args.keySecret),
    args.signature,
  );
}

// `rawBody` must be the exact text that was received. Parsing it and writing it
// back out can change spaces or key order, which changes the fingerprint.
export function verifyWebhookSignature(args: {
  rawBody: string;
  signature: string | null;
  webhookSecret: string;
}): boolean {
  if (!args.signature || !args.webhookSecret) return false;
  return safeEqualHex(
    hmacSha256Hex(args.rawBody, args.webhookSecret),
    args.signature,
  );
}
