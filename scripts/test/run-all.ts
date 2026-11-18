import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { dockerRunning } from "./docker";

// npm run test:all
//   1. checks Docker is running
//   2. starts the local Supabase stack and rebuilds its database
//   3. builds and starts the app against it
//   4. runs the integration tests, then the browser tests
//   5. stops the app and the stack
// Use --keep-stack to leave the Supabase containers running afterwards.

const keepStack = process.argv.includes("--keep-stack");
const root = process.cwd();

function step(title: string, command: string, args: string[]): number {
  console.log(`\n=== ${title} ===`);
  const r = spawnSync(command, args, {
    cwd: root,
    shell: true,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

async function waitForApp(url: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url + "/api/health");
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  if (!dockerRunning()) {
    console.error(
      "\nDocker is not running, so the integration and browser tests cannot start.\n" +
        "Start Docker Desktop, wait until it is running, and run npm run test:all again.\n" +
        "(npm test does not need Docker.)\n",
    );
    process.exit(2);
  }

  let server: ChildProcess | null = null;
  let failed = 0;
  try {
    if (
      step("Start the local Supabase stack", "npm", ["run", "stack:up"]) !== 0
    )
      process.exit(1);
    if (
      step("Rebuild the local database from the migrations", "npm", [
        "run",
        "stack:reset",
      ]) !== 0
    ) {
      process.exit(1);
    }
    if (
      step("Build the app against the local stack", "npx", [
        "tsx",
        "scripts/test/serve.ts",
        "build",
      ]) !== 0
    ) {
      process.exit(1);
    }
    server = spawn("npx", ["tsx", "scripts/test/serve.ts", "start"], {
      cwd: root,
      shell: true,
      stdio: "inherit",
    });
    if (!(await waitForApp("http://localhost:3100", 90_000))) {
      console.error("The app did not start in time.");
      process.exit(1);
    }

    failed +=
      step("Integration tests", "npm", ["run", "test:integration"]) === 0
        ? 0
        : 1;
    failed += step("Browser tests", "npm", ["run", "test:e2e"]) === 0 ? 0 : 1;
  } finally {
    if (server?.pid) {
      // shell: true started a wrapper, so stop the whole tree.
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        server.kill();
      }
    }
    if (!keepStack)
      step("Stop the local Supabase stack", "npm", ["run", "stack:down"]);
  }
  console.log(
    failed === 0
      ? "\nAll test suites passed."
      : `\n${failed} test suite(s) failed.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
