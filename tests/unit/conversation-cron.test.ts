import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cron/expire/route";
import {
  retryAfterSlotsFreed,
  waitingOn,
} from "@/lib/conversation/after-close";
import { runExpireJob } from "@/lib/conversation/expire-job";
import { expireInDb } from "@/lib/conversation/service";

// The expire endpoint's door (bearer secret), the job around the database
// function, and the "slot freed, retry waiting matches" step, with a stand-in
// for the database client.

const post = (headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/cron/expire", {
      method: "POST",
      headers,
    }),
  );

describe("POST /api/cron/expire: who may call it", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses everyone when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    expect((await post({ authorization: "Bearer anything" })).status).toBe(401);
    expect((await post({ authorization: "Bearer " })).status).toBe(401);
    expect((await post()).status).toBe(401);
  });

  it("refuses a missing or wrong secret", async () => {
    process.env.CRON_SECRET = "the-real-secret";
    expect((await post()).status).toBe(401);
    expect((await post({ authorization: "Bearer nope" })).status).toBe(401);
    expect((await post({ authorization: "the-real-secret" })).status).toBe(401);
    expect(
      (await post({ authorization: "Basic dGhlLXJlYWwtc2VjcmV0" })).status,
    ).toBe(401);
  });

  it("with the right secret but no database, says it is not set up", async () => {
    process.env.CRON_SECRET = "the-real-secret";
    const res = await post({ authorization: "Bearer the-real-secret" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("does not answer GET", async () => {
    const { GET } = (await import("@/app/api/cron/expire/route")) as Record<
      string,
      unknown
    >;
    expect(GET).toBeUndefined();
  });
});

// A stand-in for the Supabase client: every table call returns what the test
// put in `tables`, and rpc calls are recorded.
function fakeService(opts: {
  tables?: Record<string, unknown[]>;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const tables = opts.tables ?? {};
  const builder = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) =>
              resolve({ data: tables[table] ?? [], error: null });
          }
          if (prop === "maybeSingle") {
            return async () => ({
              data: (tables[table] ?? [])[0] ?? null,
              error: null,
            });
          }
          return () => builder(table);
        },
      },
    );
  const service = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const data = opts.rpc ? opts.rpc(name, args) : null;
      return { data, error: null };
    },
  };
  return { service: service as never, calls };
}

describe("expireInDb and runExpireJob", () => {
  const now = new Date("2026-11-18T10:00:00Z");

  it("passes the time to the database function and reads the counts", async () => {
    const { service, calls } = fakeService({
      rpc: () => ({
        expired: 3,
        no_first_message: 1,
        no_reply: 1,
        no_decision: 1,
        user_ids: ["u1", "u2"],
      }),
    });
    const result = await expireInDb(service, now);
    expect(calls[0]).toEqual({
      name: "expire_conversations",
      args: { p_now: now.toISOString(), p_batch: 500 },
    });
    expect(result).toEqual({
      expired: 3,
      noFirstMessage: 1,
      noReply: 1,
      noDecision: 1,
      userIds: ["u1", "u2"],
    });
  });

  it("returns null when the database call fails", async () => {
    const service = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    } as never;
    expect(await expireInDb(service, now)).toBeNull();
    await expect(runExpireJob(service, now)).rejects.toThrow();
  });

  it("does not retry anything when nothing expired", async () => {
    const { service, calls } = fakeService({
      rpc: () => ({ expired: 0, user_ids: [] }),
    });
    const outcome = await runExpireJob(service, now);
    expect(outcome).toEqual({
      expired: 0,
      noFirstMessage: 0,
      noReply: 0,
      noDecision: 0,
      opened: 0,
    });
    expect(calls.map((c) => c.name)).toEqual(["expire_conversations"]);
  });

  it("retries waiting matches for the people whose slots were freed", async () => {
    const { service, calls } = fakeService({
      tables: {
        drops: [{ id: "d1", week_start: "2026-11-16" }],
        // Used both to find who waits on the freed people and as their own
        // waiting intros.
        intros: [{ id: "i1", viewer_id: "w1", candidate_id: "c1" }],
        profiles: [
          { id: "u1", plus_until: null, paused: false },
          { id: "w1", plus_until: null, paused: false },
          { id: "u2", plus_until: null, paused: true },
        ],
        conversations: [],
      },
      rpc: (name) =>
        name === "expire_conversations"
          ? { expired: 1, no_reply: 1, user_ids: ["u1", "u2"] }
          : { status: "opened", conversation_id: "new", opener_id: "u1" },
    });
    const outcome = await runExpireJob(service, now);
    expect(outcome.expired).toBe(1);
    const retried = calls
      .filter((c) => c.name === "decide_intro")
      .map((c) => c.args.p_viewer);
    // u1 and w1 are retried; u2 is paused and skipped.
    expect(retried).toContain("u1");
    expect(retried).toContain("w1");
    expect(retried).not.toContain("u2");
    expect(outcome.opened).toBe(2);
  });
});

describe("after a slot is freed", () => {
  it("finds nobody to retry when no one was freed", async () => {
    const { service, calls } = fakeService({});
    expect(await waitingOn(service, [])).toEqual([]);
    expect(await retryAfterSlotsFreed(service, [])).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("finds nobody when there is no drop yet", async () => {
    const { service } = fakeService({ tables: { drops: [] } });
    expect(await waitingOn(service, ["u1"])).toEqual([]);
  });

  it("keeps going when one retry fails", async () => {
    let n = 0;
    const { service } = fakeService({
      tables: {
        drops: [{ id: "d1", week_start: "2026-11-16" }],
        intros: [{ id: "i1", viewer_id: "w1", candidate_id: "c1" }],
        profiles: [
          { id: "u1", plus_until: null, paused: false },
          { id: "w1", plus_until: null, paused: false },
        ],
      },
      rpc: () => {
        n += 1;
        if (n === 1) throw new Error("network");
        return { status: "interest_saved", reason: "waiting" };
      },
    });
    await expect(
      retryAfterSlotsFreed(service, ["u1"], new Date("2026-11-18T10:00:00Z")),
    ).resolves.toBe(0);
    expect(n).toBeGreaterThan(1);
  });
});

vi.mock("@/lib/events", () => ({ logEvent: async () => undefined }));
