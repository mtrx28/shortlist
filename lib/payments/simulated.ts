import { randomBytes } from "node:crypto";
import {
  hmacSha256Hex,
  paymentSignature,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./signature";
import type { CreateOrderInput, PaymentProvider, ProviderOrder } from "./types";
import { parseRazorpayWebhook } from "./webhook";

// A stand-in for Razorpay that needs no account, so the whole purchase flow
// works locally, in the browser tests and in any deployment without keys.
//
// It is NOT a payment: nobody is charged and the "checkout" page says
// SIMULATED. It follows the same rules as the real thing, though: orders are
// made on the server, the checkout hands back a payment id and a signed
// callback, and the server verifies that signature exactly like Razorpay's. That
// way the code path that grants Plus is the same one the real provider uses.
//
// The secrets are derived from a server-only value (the database service key),
// so a visitor cannot forge a callback without it. In a deployment with
// simulated payments anyone can still "pay" on the fake checkout, by design.

export function simulatedSecrets(serverSecret: string) {
  return {
    keySecret: hmacSha256Hex("simulated-key-secret", serverSecret),
    webhookSecret: hmacSha256Hex("simulated-webhook-secret", serverSecret),
  };
}

export class SimulatedProvider implements PaymentProvider {
  readonly name = "simulated" as const;
  readonly mode = "simulated" as const;
  private keySecret: string;
  private webhookSecret: string;

  // `webhookSecretOverride` lets a test (or an owner) use the same
  // RAZORPAY_WEBHOOK_SECRET for both providers.
  constructor(serverSecret: string, webhookSecretOverride?: string | null) {
    const s = simulatedSecrets(serverSecret);
    this.keySecret = s.keySecret;
    this.webhookSecret = webhookSecretOverride || s.webhookSecret;
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    return {
      id: `order_sim_${randomBytes(9).toString("hex")}`,
      amountPaise: input.amountPaise,
      currency: input.currency,
    };
  }

  verifyPayment(args: {
    orderId: string;
    paymentId: string;
    signature: string;
  }) {
    return verifyPaymentSignature({ ...args, keySecret: this.keySecret });
  }

  verifyWebhook(rawBody: string, signature: string | null) {
    return verifyWebhookSignature({
      rawBody,
      signature,
      webhookSecret: this.webhookSecret,
    });
  }

  parseWebhook(rawBody: string) {
    return parseRazorpayWebhook(rawBody);
  }

  publicConfig() {
    return { keyId: null };
  }

  // What the fake checkout page "returns" after Pay is pressed: a payment id
  // and the signature Razorpay's checkout would have produced.
  simulatePayment(orderId: string) {
    const paymentId = `pay_sim_${randomBytes(9).toString("hex")}`;
    return {
      paymentId,
      signature: paymentSignature(orderId, paymentId, this.keySecret),
    };
  }
}
