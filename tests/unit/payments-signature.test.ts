import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hmacSha256Hex,
  paymentSignature,
  safeEqualHex,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "@/lib/payments/signature";

// The signature rules from Razorpay's documentation:
//   payment callback: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
//   webhook:          HMAC_SHA256(raw body, webhook_secret)
// The expected values below are computed here with Node's own crypto, written
// separately from the code under test, so the two cannot share a mistake.

const KEY_SECRET = "test_key_secret_for_unit_tests";
const WEBHOOK_SECRET = "test_webhook_secret_for_unit_tests";
const expectedPayment = (o: string, p: string) =>
  createHmac("sha256", KEY_SECRET).update(`${o}|${p}`).digest("hex");

describe("payment callback signature", () => {
  it("matches the documented construction", () => {
    expect(paymentSignature("order_ABC", "pay_XYZ", KEY_SECRET)).toBe(
      expectedPayment("order_ABC", "pay_XYZ"),
    );
  });

  it("accepts the genuine signature, in upper or lower case", () => {
    const sig = expectedPayment("order_ABC", "pay_XYZ");
    const base = {
      orderId: "order_ABC",
      paymentId: "pay_XYZ",
      keySecret: KEY_SECRET,
    };
    expect(verifyPaymentSignature({ ...base, signature: sig })).toBe(true);
    expect(
      verifyPaymentSignature({ ...base, signature: sig.toUpperCase() }),
    ).toBe(true);
  });

  it("rejects a tampered signature, order, payment or secret", () => {
    const sig = expectedPayment("order_ABC", "pay_XYZ");
    const base = {
      orderId: "order_ABC",
      paymentId: "pay_XYZ",
      keySecret: KEY_SECRET,
      signature: sig,
    };
    const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(verifyPaymentSignature({ ...base, signature: flipped })).toBe(false);
    expect(verifyPaymentSignature({ ...base, orderId: "order_ABD" })).toBe(
      false,
    );
    expect(verifyPaymentSignature({ ...base, paymentId: "pay_XYY" })).toBe(
      false,
    );
    expect(verifyPaymentSignature({ ...base, keySecret: "another" })).toBe(
      false,
    );
  });

  it("rejects empty, short, long and non-hex signatures", () => {
    const base = {
      orderId: "order_ABC",
      paymentId: "pay_XYZ",
      keySecret: KEY_SECRET,
    };
    for (const signature of [
      "",
      "abc",
      "z".repeat(64),
      "0".repeat(63),
      "0".repeat(65),
    ]) {
      expect(verifyPaymentSignature({ ...base, signature })).toBe(false);
    }
  });

  it("rejects ids that contain the separator (they could shift the boundary)", () => {
    // order "a|b" + payment "c" and order "a" + payment "b|c" would sign the same text.
    const sig = expectedPayment("a|b", "c");
    expect(
      verifyPaymentSignature({
        orderId: "a|b",
        paymentId: "c",
        signature: sig,
        keySecret: KEY_SECRET,
      }),
    ).toBe(false);
    expect(
      verifyPaymentSignature({
        orderId: "a",
        paymentId: "b|c",
        signature: sig,
        keySecret: KEY_SECRET,
      }),
    ).toBe(false);
  });

  it("rejects when the secret or an id is missing", () => {
    const sig = expectedPayment("order_ABC", "pay_XYZ");
    expect(
      verifyPaymentSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature: sig,
        keySecret: "",
      }),
    ).toBe(false);
    expect(
      verifyPaymentSignature({
        orderId: "",
        paymentId: "pay_XYZ",
        signature: sig,
        keySecret: KEY_SECRET,
      }),
    ).toBe(false);
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: { a: 1 } });
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

  it("accepts the signature of the exact raw body", () => {
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signature: sig,
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a body that changed by a single space or key order", () => {
    for (const changed of [
      body + " ",
      body.replace('"a":1', '"a": 1'),
      body.replace("captured", "capturez"),
    ]) {
      expect(
        verifyWebhookSignature({
          rawBody: changed,
          signature: sig,
          webhookSecret: WEBHOOK_SECRET,
        }),
      ).toBe(false);
    }
  });

  it("rejects a missing signature, a wrong secret and an empty secret", () => {
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signature: null,
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signature: "",
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signature: sig,
        webhookSecret: "other",
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signature: sig,
        webhookSecret: "",
      }),
    ).toBe(false);
  });
});

describe("safeEqualHex and hmacSha256Hex", () => {
  it("compares equal hex strings as equal and anything else as different", () => {
    expect(safeEqualHex("00ff", "00FF")).toBe(true);
    expect(safeEqualHex("00ff", "00fe")).toBe(false);
    expect(safeEqualHex("00ff", "00ff00")).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
    expect(safeEqualHex("00fg", "00fg")).toBe(false);
    // Not strings at all (defensive: values come from a browser).
    expect(safeEqualHex(undefined as unknown as string, "00")).toBe(false);
  });

  it("hmacSha256Hex is plain HMAC-SHA256 in hex", () => {
    expect(hmacSha256Hex("hello", "key")).toBe(
      createHmac("sha256", "key").update("hello").digest("hex"),
    );
    // A published HMAC-SHA256 test value (RFC 4231 style, short key "key").
    expect(
      hmacSha256Hex("The quick brown fox jumps over the lazy dog", "key"),
    ).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});
