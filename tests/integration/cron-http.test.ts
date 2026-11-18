import { beforeAll, describe, expect, it } from "vitest";
import { env, service } from "../support/stack";

// The cron endpoints over real HTTP, with the real secret. They need the app
// to be running against the local stack (npm run test:all starts it; to run by
// hand: build with `npx tsx scripts/test/serve.ts build`, then start with
// `npx tsx scripts/test/serve.ts start`). Without it these tests are skipped
// with a clear reason instead of failing.

let appUp = false;
beforeAll(async () => {
  try {
    appUp = (await fetch(env.appUrl + "/api/health")).ok;
  } catch {
    appUp = false;
  }
  if (!appUp)
    console.warn(
      `SKIPPED cron HTTP tests: the app is not running at ${env.appUrl}`,
    );
});

const post = (path: string, secret?: string) =>
  fetch(env.appUrl + path, {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });

describe("cron endpoints over HTTP", () => {
  for (const path of [
    "/api/cron/keepalive",
    "/api/cron/expire",
    "/api/cron/drop",
  ]) {
    it(`${path} refuses a missing or wrong secret`, async (ctx) => {
      if (!appUp) return ctx.skip();
      expect((await post(path)).status).toBe(401);
      expect((await post(path, "wrong-secret")).status).toBe(401);
    });
  }

  it("keepalive answers ok with the secret", async (ctx) => {
    if (!appUp) return ctx.skip();
    const res = await post("/api/cron/keepalive", env.cronSecret);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("expire ends a chat whose window is over, and a second run finds nothing", async (ctx) => {
    if (!appUp) return ctx.skip();
    // Two people and an open chat whose window ended an hour ago.
    const { createMember, finishProfile, removeMembers, uniq } =
      await import("../support/stack");
    const city = uniq("City");
    const a = await createMember("CronA");
    const b = await createMember("CronB");
    try {
      await finishProfile(a, { gender: "woman", interestedIn: ["man"], city });
      await finishProfile(b, { gender: "man", interestedIn: ["woman"], city });
      const { data } = await service
        .from("conversations")
        .insert({
          user_a: a.id,
          user_b: b.id,
          opener_id: a.id,
          status: "open",
          opened_at: new Date(Date.now() - 74 * 3600 * 1000).toISOString(),
          window_ends_at: new Date(Date.now() - 3600 * 1000).toISOString(),
        })
        .select("id")
        .single();
      const first = await post("/api/cron/expire", env.cronSecret);
      expect(first.status).toBe(200);
      const body = await first.json();
      expect(body.expired).toBeGreaterThanOrEqual(1);
      const { data: row } = await service
        .from("conversations")
        .select("status, closed_reason")
        .eq("id", data!.id)
        .single();
      expect(row?.status).toBe("expired");
      const second = await (
        await post("/api/cron/expire", env.cronSecret)
      ).json();
      expect(second.expired).toBe(0);
    } finally {
      await removeMembers([a, b]);
    }
  });

  it("drop runs with the secret and is safe to run twice", async (ctx) => {
    if (!appUp) return ctx.skip();
    const first = await post("/api/cron/drop", env.cronSecret);
    expect(first.status).toBe(200);
    const one = await first.json();
    expect(["created", "exists", "rebuilt", "skipped"]).toContain(one.status);
    const second = await (await post("/api/cron/drop", env.cronSecret)).json();
    expect(second.weekStart).toBe(one.weekStart);
  });
});
