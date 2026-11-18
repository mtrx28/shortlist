import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PLANS, formatRupees, isPlanId } from "@/config/plans";
import { SimulatedCheckoutForm } from "@/components/plus/simulated-checkout-form";
import { ModeRibbon } from "@/components/plus/mode-ribbon";
import {
  PaymentConfigError,
  getPaymentProvider,
  modeLabel,
} from "@/lib/payments/select";
import { SimulatedProvider } from "@/lib/payments/simulated";
import { requireUserProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Simulated checkout | Shortlist",
  robots: { index: false, follow: false },
};

// The fake checkout page. It exists only when the simulated provider is in use
// (otherwise it is a 404), and only for the member who made the order and only
// while the order is still waiting for payment.
export default async function SimulatedCheckoutPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();

  const { supabase, userId } = await requireUserProfile();

  let provider;
  try {
    provider = getPaymentProvider();
  } catch (e) {
    if (e instanceof PaymentConfigError) notFound();
    throw e;
  }
  if (!(provider instanceof SimulatedProvider)) notFound();

  // Read with the member's own session: row level security only returns their
  // own orders.
  const { data: order } = await supabase
    .from("orders")
    .select("id, razorpay_order_id, plan, amount_paise, status")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!order || !isPlanId(order.plan)) notFound();

  const plan = PLANS[order.plan];
  const done = order.status === "paid";
  // A fresh "payment" for this order, signed like Razorpay would.
  const sim = provider.simulatePayment(order.razorpay_order_id as string);

  return (
    <section className="mx-auto max-w-md space-y-6">
      <ModeRibbon {...modeLabel(provider)} />
      <h1 className="text-2xl font-semibold tracking-tight">
        Simulated checkout
      </h1>
      <div className="space-y-1 rounded-lg border p-4 text-sm">
        <p className="font-medium">Shortlist Plus, {plan.label}</p>
        <p>{formatRupees(order.amount_paise as number)}, one payment</p>
        <p className="text-muted-foreground text-xs">
          This page stands in for Razorpay&apos;s payment window. There is no
          card form on purpose.
        </p>
      </div>

      {done ? (
        <p role="status" className="text-sm">
          This order is already paid.{" "}
          <Link href="/plus" className="underline">
            Back to Plus
          </Link>
        </p>
      ) : (
        <SimulatedCheckoutForm
          providerOrderId={order.razorpay_order_id as string}
          paymentId={sim.paymentId}
          signature={sim.signature}
        />
      )}
      <p className="text-sm">
        <Link href="/plus" className="underline">
          Cancel and go back
        </Link>
      </p>
    </section>
  );
}
