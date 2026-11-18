import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENV_FILE,
  assertLocalSupabase,
  parseEnvFile,
} from "../../tests/support/env";

// Builds and starts the Next.js app against the LOCAL Supabase stack, for the
// integration (cron) and browser tests.
//   tsx scripts/test/serve.ts build    build into .next-test
//   tsx scripts/test/serve.ts start    serve it on port 3100
//
// Every setting comes from .env.test.local. They are put into the process
// environment before Next.js starts, and Next.js never overrides a variable
// that is already set, so nothing in .env.local (the real project) can
// reach this app. The build goes to its own folder (.next-test) so a normal
// dev server or build is not disturbed.

const root = process.cwd();
const fileVars = parseEnvFile(readFileSync(join(root, ENV_FILE), "utf8"));
assertLocalSupabase(fileVars.NEXT_PUBLIC_SUPABASE_URL);

const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...fileVars,
  NEXT_DIST_DIR: ".next-test",
  NEXT_TELEMETRY_DISABLED: "1",
};

const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const port =
  new URL(fileVars.NEXT_PUBLIC_APP_URL || "http://localhost:3100").port ||
  "3100";
const mode = process.argv[2];

if (mode === "build") {
  const r = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
} else if (mode === "start") {
  const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  console.error("Usage: tsx scripts/test/serve.ts build | start");
  process.exit(1);
}
