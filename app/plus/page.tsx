import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoGrant } from "@/components/plus/demo-grant";
import { BuyPanel } from "@/components/plus/buy-panel";
import { ModeRibbon } from "@/components/plus/mode-ribbon";
import {
  FREE_LIMITS,
  NEVER_PAYWALLED,
  PLANS,
  PLAN_IDS,
  PLUS_PERKS,
  SECOND_LOOK,
  formatRupees,
} from "@/config/plans";
import { demoControlsEnabled } from "@/lib/conversation/demo";
import { homeRedirect } from "@/lib/onboarding";
import {
  PaymentConfigError,
  getPaymentProvider,
  modeLabel,
} from "@/lib/payments/select";
import { isPlus } from "@/lib/plus";
import { requireUserProfile } from "@/lib/profile";
import { createAdminClient } from "@/lib/supabase/admin";

// Reads the session and the clock, so it must never be prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "Shortlist Plus | Shortlist" };

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "long",
  timeZone: "Asia/Kolkata",
});

export default async function PlusPage() {
  const { supabase, userId, state } = await requireUserProfile();
  const away = homeRedirect(state);
  if (away) redirect(away);

  const now = new Date();
  const { data: row } = await supabase
    .from("profiles")
    .select("plus_until")
    .eq("id", userId)
    .maybeSingle();
  const plusUntil = (row?.plus_until as string | null) ?? null;
  const active = isPlus(plusUntil, now);

  // Which provider is in use, and is it set up properly?
  let ribbon: { ribbon: string | null; detail: string } | null = null;
  let configError: string | null = null;
  try {
    ribbon = modeLabel(getPaymentProvider());
  } catch (e) {
    if (!(e instanceof PaymentConfigError)) throw e;
    configError = "Payments are not set up correctly on this server.";
  }

  // The demo helper: three locks (setting, demo account, own account).
  let showDemo = false;
  if (demoControlsEnabled()) {
    const service = createAdminClient();
    if (service) {
      const { data } = await service.auth.admin.getUserById(userId);
      showDemo = data.user?.app_metadata?.demo === true;
    }
  }

  const plans = PLAN_IDS.map((id) => ({
    id,
    label: PLANS[id].label,
    price: formatRupees(PLANS[id].amountPaise),
    blurb: PLANS[id].blurb,
  }));

  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Shortlist Plus
        </h1>
        <p className="text-muted-foreground text-sm">
          Plus is for people who use Shortlist a lot and hit its limits. It does
          not make you more visible, and it never unlocks safety. Everything
          that keeps you safe is free.
        </p>
      </div>

      {ribbon && <ModeRibbon ribbon={ribbon.ribbon} detail={ribbon.detail} />}

      {active && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          You have Plus until{" "}
          <strong>{dateFormat.format(new Date(plusUntil!))}</strong>. If you buy
          again, the new time is added after that date.
        </p>
      )}

      <div>
        <h2 className="mb-2 text-base font-medium">
          Free and Plus, side by side
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              What you get with the free plan and with Plus
            </caption>
            <thead className="bg-muted/60">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  What
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Free
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Plus
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <th scope="row" className="px-3 py-2 font-normal">
                  Intros every Sunday
                </th>
                <td className="px-3 py-2">{FREE_LIMITS.introsPerDrop}</td>
                <td className="px-3 py-2">{PLUS_PERKS.introsPerDrop}</td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 font-normal">
                  Chats open at once
                </th>
                <td className="px-3 py-2">{FREE_LIMITS.chatCap}</td>
                <td className="px-3 py-2">{PLUS_PERKS.chatCap}</td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 font-normal">
                  &quot;Why we matched&quot;
                </th>
                <td className="px-3 py-2">The top two reasons</td>
                <td className="px-3 py-2">
                  The full breakdown: every topic you agree on, and how close
                  you are overall
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 font-normal">
                  Second look
                </th>
                <td className="px-3 py-2">Not included</td>
                <td className="px-3 py-2">
                  Once every {SECOND_LOOK.perDays} days, bring back one intro
                  from the last {SECOND_LOOK.lookbackDays / 7} weeks that you
                  passed on or let expire
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-2 font-normal">
                  Safety, verification, being seen
                </th>
                <td className="px-3 py-2">Always free</td>
                <td className="px-3 py-2">Always free</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {configError ? (
        <p role="alert" className="text-destructive text-sm">
          {configError} Nothing can be bought right now.
        </p>
      ) : (
        <div className="space-y-2">
          <h2 className="text-base font-medium">Choose how long</h2>
          <BuyPanel plans={plans} />
        </div>
      )}

      <section aria-label="What stays free" className="space-y-2">
        <h2 className="text-base font-medium">What we will never charge for</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {NEVER_PAYWALLED.map((f) => (
            <li key={f.key}>{f.label}</li>
          ))}
        </ul>
      </section>

      <section aria-label="Fine print" className="space-y-2">
        <h2 className="text-base font-medium">The fine print</h2>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>
            Plus is a one-time purchase for the period you choose. It does not
            renew by itself, and we do not store your card or set up any
            recurring payment.
          </li>
          <li>
            Prices are in Indian rupees and include 18% GST (a draft assumption
            for this demonstration). A real launch needs an invoice and an
            accountant&apos;s check.
          </li>
          <li>
            When Plus ends, nothing is deleted. Chats you already have stay
            open; you simply cannot open new ones past the free limit of{" "}
            {FREE_LIMITS.chatCap}.
          </li>
          <li>
            Refunds and what happens if something goes wrong are described in
            the{" "}
            <Link href="/terms" className="underline">
              Terms
            </Link>
            . For a payment problem use the{" "}
            <Link href="/grievance" className="underline">
              grievance and contact page
            </Link>
            .
          </li>
        </ul>
      </section>

      {showDemo && <DemoGrant />}

      <p className="text-sm">
        <Link href="/home" className="underline">
          Back to home
        </Link>
      </p>
    </section>
  );
}
