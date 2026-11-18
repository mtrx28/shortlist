// The shape every payment provider has to fit. The rest of the app only talks
// to this interface, so Razorpay and the local "simulated" provider can be
// swapped without touching the pages or the database code.

export type ProviderName = "razorpay" | "simulated";

// "test" and "live" are Razorpay's two modes (decided by the key id prefix).
// "simulated" means no payment company is involved at all.
export type ProviderMode = "test" | "live" | "simulated";

export type CreateOrderInput = {
  amountPaise: number;
  currency: "INR";
  receipt: string; // our own reference, shown in Razorpay's dashboard
  notes: Record<string, string>; // small labels only, never personal data
};

export type ProviderOrder = {
  id: string; // the provider's order id (order_...)
  amountPaise: number;
  currency: string;
};

// What a webhook says, reduced to what we use.
export type WebhookEvent =
  | {
      kind: "paid";
      orderId: string;
      paymentId: string;
      amountPaise: number;
      currency: string;
    }
  | {
      kind: "failed";
      orderId: string;
      paymentId: string | null;
      reason: string | null;
    };

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly mode: ProviderMode;

  // Creates an order with the provider (the amount is always chosen by the
  // server from config/plans.ts).
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;

  // Is this browser callback (order id, payment id, signature) genuine?
  verifyPayment(args: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;

  // Is this webhook genuine? Needs the raw body and the signature header.
  verifyWebhook(rawBody: string, signature: string | null): boolean;

  // Turns a (verified) webhook body into an event, or null for events we
  // do not use.
  parseWebhook(rawBody: string): WebhookEvent | null;

  // Only what the browser needs to open the checkout. Never a secret.
  publicConfig(): { keyId: string | null };
}
