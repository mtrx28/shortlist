import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isLocalUrl } from "@/lib/local-url";

// Loads the settings of the LOCAL Supabase stack from .env.test.local (written
// by `npm run stack:up`) and nothing else. This file never reads .env.local,
// which belongs to the real project, and it stops with an error if the
// Supabase address is not on this machine, so a test can never create or delete
// users in the real project by mistake.

export type TestEnv = {
  url: string; // Supabase API, e.g. http://127.0.0.1:54321
  anonKey: string;
  serviceKey: string;
  mailpitUrl: string;
  appUrl: string; // where the Next.js app under test listens
  cronSecret: string;
  demoPassword: string;
  elitmusSecret: string;
  safetySecret: string;
  webhookSecret: string; // signs the test webhooks the app verifies
};

export const ENV_FILE = ".env.test.local";

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

export function assertLocalSupabase(
  url: string | undefined,
): asserts url is string {
  if (!isLocalUrl(url)) {
    throw new Error(
      `Refusing to run: the Supabase address "${url ?? "(missing)"}" is not on this machine. ` +
        "The test tools only use the local stack (127.0.0.1 or localhost).",
    );
  }
}

export function loadTestEnv(root = process.cwd()): TestEnv {
  const file = join(root, ENV_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `${ENV_FILE} not found. Start the local stack first: npm run stack:up`,
    );
  }
  const v = parseEnvFile(readFileSync(file, "utf8"));
  assertLocalSupabase(v.NEXT_PUBLIC_SUPABASE_URL);
  const need = (key: string) => {
    if (!v[key])
      throw new Error(
        `${ENV_FILE} is missing ${key}. Run npm run stack:up again.`,
      );
    return v[key];
  };
  return {
    url: v.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    mailpitUrl: need("MAILPIT_URL"),
    appUrl: v.NEXT_PUBLIC_APP_URL || "http://localhost:3100",
    cronSecret: need("CRON_SECRET"),
    demoPassword: need("DEMO_PASSWORD"),
    elitmusSecret: need("ELITMUS_HASH_SECRET"),
    safetySecret: need("SAFETY_HASH_SECRET"),
    webhookSecret: need("RAZORPAY_WEBHOOK_SECRET"),
  };
}
