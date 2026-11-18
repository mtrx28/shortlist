import { RazorpayProvider } from "./razorpay";
import { SimulatedProvider } from "./simulated";
import type { PaymentProvider } from "./types";

// Chooses the payment provider from the environment, with guards so the app
// can never quietly do the wrong thing with money:
//
//   * PAYMENT_PROVIDER=simulated        -> simulated, always.
//   * PAYMENT_PROVIDER=razorpay         -> Razorpay; both keys are required.
//   * not set                           -> Razorpay if both keys are set,
//                                          simulated if NEITHER is set.
//   * only one of the two keys is set   -> an error, in every environment.
//     A half-set configuration is a mistake; falling back to the fake
//     checkout would hide it (and in production would look like a working shop).
//   * key id starting rzp_live_         -> refused unless ALLOW_LIVE_PAYMENTS is
//     exactly "true". That switch is NOT for this submission: it is a test-mode
//     project and real money is out of scope.
//   * any other key id prefix           -> an error.

export class PaymentConfigError extends Error {}

type Env = Record<string, string | undefined>;

export function getPaymentProvider(env: Env = process.env): PaymentProvider {
  const wanted = (env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  if (wanted && wanted !== "simulated" && wanted !== "razorpay") {
    throw new PaymentConfigError(
      'PAYMENT_PROVIDER must be "simulated" or "razorpay" (or empty).',
    );
  }

  const keyId = (env.RAZORPAY_KEY_ID ?? "").trim();
  const keySecret = (env.RAZORPAY_KEY_SECRET ?? "").trim();
  const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET ?? "").trim() || null;

  if (wanted === "simulated") return simulated(env, webhookSecret);

  if (Boolean(keyId) !== Boolean(keySecret)) {
    throw new PaymentConfigError(
      "Only one of RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET is set. Set both, or neither to use the simulated checkout.",
    );
  }
  if (!keyId) {
    if (wanted === "razorpay") {
      throw new PaymentConfigError(
        "PAYMENT_PROVIDER=razorpay needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
      );
    }
    return simulated(env, webhookSecret);
  }

  if (keyId.startsWith("rzp_live_")) {
    if (env.ALLOW_LIVE_PAYMENTS !== "true") {
      throw new PaymentConfigError(
        "A live Razorpay key is set. This project only supports test mode; live payments stay off unless ALLOW_LIVE_PAYMENTS=true (not for the submission).",
      );
    }
    return new RazorpayProvider(keyId, keySecret, webhookSecret, "live");
  }
  if (keyId.startsWith("rzp_test_")) {
    return new RazorpayProvider(keyId, keySecret, webhookSecret, "test");
  }
  throw new PaymentConfigError(
    "RAZORPAY_KEY_ID must start with rzp_test_ (test mode).",
  );
}

function simulated(env: Env, webhookSecret: string | null) {
  // The simulated secrets are derived from a server-only value.
  const serverSecret = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverSecret) {
    throw new PaymentConfigError(
      "The simulated checkout needs the server's SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return new SimulatedProvider(serverSecret, webhookSecret);
}

// The text on the paywall for the current mode. Always says TEST (or
// SIMULATED) unless the owner turned live payments on.
export function modeLabel(provider: PaymentProvider): {
  ribbon: string | null;
  detail: string;
} {
  if (provider.mode === "simulated") {
    return {
      ribbon: "TEST MODE - SIMULATED CHECKOUT",
      detail:
        "No payment company is connected here. The checkout is a fake page, nobody is charged, and no card details are asked for.",
    };
  }
  if (provider.mode === "test") {
    return {
      ribbon: "TEST MODE - NO REAL MONEY",
      detail:
        "Payments run in Razorpay's test mode. Use one of Razorpay's published test cards; real cards are not charged.",
    };
  }
  return { ribbon: null, detail: "" };
}
