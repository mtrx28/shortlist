import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isLocalUrl } from "@/lib/local-url";
import { ENV_FILE, parseEnvFile } from "../../tests/support/env";
import { dockerRunning } from "./docker";

// Controls the LOCAL Supabase stack used by the integration and browser tests.
//   npm run stack:up      start it (needs Docker) and write .env.test.local
//   npm run stack:reset   rebuild the database from the migrations (clean slate)
//   npm run stack:down    stop it
// It only ever runs `supabase start`, `supabase db reset` (local) and
// `supabase stop`. It never pushes anything to a hosted project.

const root = process.cwd();

// Parts of the stack the tests do not need. Leaving them out makes startup
// faster and lighter.
const EXCLUDE =
  "studio,imgproxy,edge-runtime,vector,logflare,postgres-meta,supavisor";

// How to start the Supabase CLI. On a developer machine "npx supabase" is
// fine; the CI workflow installs the CLI itself and sets SUPABASE_CLI=supabase.
const CLI = (process.env.SUPABASE_CLI || "npx supabase").split(" ");

function run(args: string[], capture = false) {
  return spawnSync(CLI[0], [...CLI.slice(1), ...args], {
    cwd: root,
    shell: true,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function requireDocker() {
  if (!dockerRunning()) {
    console.error(
      "\nDocker is not running. Start Docker Desktop (or the Docker service), wait until it says it is running, then try again.\n",
    );
    process.exit(2);
  }
}

// Writes .env.test.local from the running stack. These are the well-known
// local development keys that every local Supabase stack uses; they open
// nothing outside this machine.
function writeEnv() {
  const r = run(["status", "-o", "env"], true);
  if (r.status !== 0) {
    console.error(
      "Could not read the stack status. Is it running?\n",
      r.stderr,
    );
    process.exit(1);
  }
  const s = parseEnvFile(r.stdout);
  if (!isLocalUrl(s.API_URL) || !s.ANON_KEY || !s.SERVICE_ROLE_KEY) {
    console.error(
      "The stack status did not look like a local stack. Stopping.",
    );
    process.exit(1);
  }
  const lines = [
    "# Written by `npm run stack:up`. Settings of the LOCAL Supabase stack only.",
    "# The tests and the test app server read this file and nothing else.",
    `NEXT_PUBLIC_SUPABASE_URL=${s.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${s.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${s.SERVICE_ROLE_KEY}`,
    `MAILPIT_URL=${s.MAILPIT_URL ?? "http://127.0.0.1:54324"}`,
    "NEXT_PUBLIC_APP_URL=http://localhost:3100",
    "CRON_SECRET=local-test-cron-secret-0123456789",
    "ELITMUS_HASH_SECRET=local-test-elitmus-secret-0123456789",
    "SAFETY_HASH_SECRET=local-test-safety-secret-0123456789",
    "DEMO_PASSWORD=local-demo-password-1",
    "DEMO_CONTROLS=true",
    "DEMO_AUTO_VERIFY=false",
    "RAZORPAY_KEY_ID=",
    "RAZORPAY_KEY_SECRET=",
    // Payments in the tests use the simulated provider. The webhook secret is a
    // made-up test value: the tests sign webhooks with it, the app verifies with it.
    "PAYMENT_PROVIDER=simulated",
    "RAZORPAY_WEBHOOK_SECRET=local-test-webhook-secret-0123456789",
    "ALLOW_LIVE_PAYMENTS=false",
    "",
  ];
  writeFileSync(join(root, ENV_FILE), lines.join("\n"));
  console.log(`Wrote ${ENV_FILE} (local stack at ${s.API_URL}).`);
}

const command = process.argv[2];

if (command === "up") {
  requireDocker();
  const r = run(["start", "-x", EXCLUDE]);
  if (r.status !== 0) process.exit(r.status ?? 1);
  writeEnv();
} else if (command === "reset") {
  requireDocker();
  const r = run(["db", "reset", "--no-seed"]);
  if (r.status !== 0) process.exit(r.status ?? 1);
  writeEnv();
} else if (command === "down") {
  if (!dockerRunning()) {
    console.log("Docker is not running, so there is nothing to stop.");
    process.exit(0);
  }
  process.exit(run(["stop"]).status ?? 0);
} else if (command === "env") {
  requireDocker();
  writeEnv();
} else {
  console.error("Usage: tsx scripts/test/stack.ts up | reset | down | env");
  process.exit(1);
}
