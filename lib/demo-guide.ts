import { demoControlsEnabled } from "@/lib/conversation/demo";
import { getPaymentProvider } from "@/lib/payments/select";

// What the /demo page needs to know about THIS deployment, read from the
// environment on the server. Kept apart from the page so it can be tested.

type Env = Record<string, string | undefined>;

export type DemoGuideState = {
  // The shared demo password, only when the owner chose to publish it by
  // setting DEMO_PASSWORD_PUBLIC. Otherwise null and the page points to the
  // submission form and README. This is NOT DEMO_PASSWORD (the seed secret):
  // a different variable, so the password is never shown by accident.
  publicPassword: string | null;
  controlsOn: boolean;
  payments: "simulated" | "test" | "live" | "not_configured";
  autoVerify: boolean;
};

export function readDemoGuideState(env: Env = process.env): DemoGuideState {
  const raw = (env.DEMO_PASSWORD_PUBLIC ?? "").trim();
  let payments: DemoGuideState["payments"];
  try {
    payments = getPaymentProvider(env).mode;
  } catch {
    payments = "not_configured";
  }
  return {
    // A very short value is treated as a mistake, not published.
    publicPassword: raw.length >= 8 ? raw : null,
    controlsOn: demoControlsEnabled(env),
    payments,
    autoVerify: env.DEMO_AUTO_VERIFY === "true",
  };
}
