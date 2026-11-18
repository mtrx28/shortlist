"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { confirmPaymentAction, failPaymentAction } from "@/app/plus/actions";
import { Button } from "@/components/ui/button";

// The fake checkout. "Pay" sends the payment id and signature the server put
// into the page, to the same server action the real Razorpay window uses, so
// the signature is checked the same way. (The hidden fields are ordinary form
// fields on purpose: the browser tests change one to prove that a tampered
// signature is refused.)
export function SimulatedCheckoutForm({
  providerOrderId,
  paymentId,
  signature,
}: {
  providerOrderId: string;
  paymentId: string;
  signature: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pay(form: HTMLFormElement) {
    const data = new FormData(form);
    startTransition(async () => {
      const done = await confirmPaymentAction({
        providerOrderId: String(data.get("razorpay_order_id") ?? ""),
        paymentId: String(data.get("razorpay_payment_id") ?? ""),
        signature: String(data.get("razorpay_signature") ?? ""),
      });
      router.push(done.redirectTo);
    });
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          pay(e.currentTarget);
        }}
        className="space-y-3"
      >
        <input
          type="hidden"
          name="razorpay_order_id"
          defaultValue={providerOrderId}
        />
        <input
          type="hidden"
          name="razorpay_payment_id"
          defaultValue={paymentId}
        />
        <input
          type="hidden"
          name="razorpay_signature"
          defaultValue={signature}
        />
        <Button type="submit" disabled={pending}>
          Pay (simulated, nobody is charged)
        </Button>
      </form>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const done = await failPaymentAction({
              providerOrderId,
              reason: "simulated failure",
            });
            router.push(done.redirectTo);
          })
        }
      >
        Simulate a failed payment
      </Button>
    </div>
  );
}
