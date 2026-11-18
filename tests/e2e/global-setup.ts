import { env, service, warmUpRealtime } from "../support/stack";

// Runs once before the browser tests. It only ever touches the local stack
// (support/stack.ts refuses to load otherwise).
export default async function globalSetup() {
  // Weekly drops that earlier integration tests made for invented weeks would
  // otherwise look like "the latest drop" to the screens under test.
  await service.from("drops").delete().contains("stats", { test: true });

  const res = await fetch(env.appUrl + "/api/health").catch(() => null);
  if (!res?.ok) {
    throw new Error(
      `The app is not answering at ${env.appUrl}. Run npm run test:all, or start it with the stack running.`,
    );
  }

  await warmUpRealtime();
}
