"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  confirmPaymentAction,
  failPaymentAction,
  startCheckoutAction,
} from "@/app/plus/actions";
import { Button } from "@/components/ui/button";

// The two "Get Plus" buttons. Pressing one asks the server to create an order
// (the server picks the price), then either opens Razorpay's own checkout
// window or goes to the fake checkout page. Card details are typed into
// Razorpay's window, never into this page.

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (r: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckoutScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export type PlanOption = {
  id: string;
  label: string;
  price: string; // "Rs 199"
  blurb: string;
};

export function BuyPanel({ plans }: { plans: PlanOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buy(planId: string) {
    setMessage(null);
    startTransition(async () => {
      const started = await startCheckoutAction(planId);
      if (!started.ok) {
        setMessage(started.error);
        return;
      }
      if (started.provider === "simulated") {
        router.push(started.checkoutPath);
        return;
      }

      const loaded = await loadCheckoutScript();
      if (!loaded || !window.Razorpay) {
        setMessage(
          "The payment window could not load. Check your connection and try again. Nothing was charged.",
        );
        return;
      }
      const checkout = new window.Razorpay({
        key: started.keyId,
        order_id: started.providerOrderId,
        amount: started.amountPaise,
        currency: started.currency,
        name: "Shortlist Plus",
        description: "One-time purchase, no auto-renewal",
        theme: { color: "#171717" },
        // Called by Razorpay after a successful payment. The signature is
        // checked on our server before anything is granted.
        handler: async (response: RazorpaySuccess) => {
          const done = await confirmPaymentAction({
            providerOrderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
          router.push(done.redirectTo);
        },
        modal: {
          // Closed the window without paying: the order just stays unpaid.
          ondismiss: () =>
            setMessage(
              "You closed the payment window. Nothing was charged. You can try again whenever you like.",
            ),
        },
      });
      checkout.on("payment.failed", async () => {
        const done = await failPaymentAction({
          providerOrderId: started.providerOrderId,
          reason: "payment failed in checkout",
        });
        router.push(done.redirectTo);
      });
      checkout.open();
    });
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => (
          <li key={plan.id} className="space-y-2 rounded-lg border p-4">
            <p className="text-base font-semibold">Plus, {plan.label}</p>
            <p className="text-2xl font-semibold">{plan.price}</p>
            <p className="text-muted-foreground text-xs">
              {plan.blurb}. One payment, no auto-renewal.
            </p>
            <Button
              type="button"
              disabled={pending}
              onClick={() => buy(plan.id)}
              aria-label={`Get Plus for ${plan.label}, ${plan.price}`}
            >
              {pending ? "Please wait..." : `Get Plus for ${plan.label}`}
            </Button>
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
