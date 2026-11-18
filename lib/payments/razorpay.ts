import { verifyPaymentSignature, verifyWebhookSignature } from "./signature";
import type {
  CreateOrderInput,
  PaymentProvider,
  ProviderMode,
  ProviderOrder,
} from "./types";
import { parseRazorpayWebhook } from "./webhook";

// Razorpay through its REST API, with plain fetch (no SDK: one call is all we
// need, and a small file is easier to read than a library). The key id and
// secret are read on the server only and never reach the browser; the browser
// gets the key id (public by design) to open Razorpay's own checkout window,
// so card details go to Razorpay and never touch this server.
//
// Docs: https://razorpay.com/docs/api/orders/

const ORDERS_URL = "https://api.razorpay.com/v1/orders";

export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay" as const;

  constructor(
    private keyId: string,
    private keySecret: string,
    private webhookSecret: string | null,
    readonly mode: ProviderMode,
    // Replaceable in tests so no real network call is made.
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString(
      "base64",
    );
    const res = await this.fetchImpl(ORDERS_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      }),
      // Do not hang a page forever on a slow API.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // The body can describe the problem (for example bad keys). It is not
      // shown to the member and never logged here.
      throw new Error(`Razorpay refused to create the order (${res.status}).`);
    }
    const body = (await res.json()) as {
      id?: unknown;
      amount?: unknown;
      currency?: unknown;
    };
    if (
      typeof body.id !== "string" ||
      body.amount !== input.amountPaise ||
      body.currency !== input.currency
    ) {
      throw new Error("Razorpay answered with an order we did not expect.");
    }
    return {
      id: body.id,
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
    // Without a webhook secret nothing can be verified, so nothing passes.
    if (!this.webhookSecret) return false;
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
    return { keyId: this.keyId };
  }
}
