import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { PAYMENT_LIMITS, PLANS } from "@/config/plans";
import {
  applyWebhook,
  confirmPayment,
  createPlusOrder,
} from "@/lib/payments/service";
import { SimulatedProvider } from "@/lib/payments/simulated";
import { hmacSha256Hex } from "@/lib/payments/signature";

// The server flow with a pretend database, so every branch is covered without
// a network. The database function itself is tested in tests/rls/plus.test.ts.

const provider = new SimulatedProvider(
  "unit-test-server-secret",
  "unit-webhook-secret",
);
const USER = "11111111-1111-4111-8111-111111111111";

type RpcCall = [string, Record<string, unknown>];
function fakeDb(opts: {
  recentOrders?: number;
  rpcAnswer?: unknown;
  rpcError?: boolean;
  insertError?: boolean;
}) {
  const inserted: Record<string, unknown>[] = [];
  const rpcCalls: RpcCall[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: async () => ({ count: opts.recentOrders ?? 0, error: null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () =>
              opts.insertError
                ? { data: null, error: { message: "boom" } }
                : { data: { id: "order-row-id" }, error: null },
          }),
        };
      },
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return opts.rpcError
        ? { data: null, error: { message: "boom" } }
        : { data: opts.rpcAnswer ?? null, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, inserted, rpcCalls };
}

describe("createPlusOrder", () => {
  it("takes the price from config, never from the caller, and stores the order", async () => {
    const { db, inserted } = fakeDb({});
    const out = await createPlusOrder({
      db,
      provider,
      userId: USER,
      planId: "plus_3m",
    });
    expect(out.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      user_id: USER,
      plan: "plus_3m",
      amount_paise: PLANS.plus_3m.amountPaise,
      currency: "INR",
      days: 90,
      provider: "simulated",
      status: "created",
    });
    if (out.ok) expect(out.amountPaise).toBe(49900);
  });

  it("refuses an unknown plan before touching anything", async () => {
    const { db, inserted } = fakeDb({});
    for (const planId of ["plus_9m", "", undefined, { amount: 1 }]) {
      expect(
        await createPlusOrder({ db, provider, userId: USER, planId }),
      ).toEqual({
        ok: false,
        reason: "invalid_plan",
      });
    }
    expect(inserted).toHaveLength(0);
  });

  it("limits how many orders one person can start in an hour", async () => {
    const { db, inserted } = fakeDb({
      recentOrders: PAYMENT_LIMITS.ordersPerHour,
    });
    expect(
      await createPlusOrder({ db, provider, userId: USER, planId: "plus_1m" }),
    ).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(inserted).toHaveLength(0);
    const below = fakeDb({ recentOrders: PAYMENT_LIMITS.ordersPerHour - 1 });
    expect(
      (
        await createPlusOrder({
          db: below.db,
          provider,
          userId: USER,
          planId: "plus_1m",
        })
      ).ok,
    ).toBe(true);
  });

  it("answers failed when the provider or the database fails", async () => {
    const failing = {
      ...provider,
      createOrder: async () => {
        throw new Error("down");
      },
    } as unknown as SimulatedProvider;
    expect(
      await createPlusOrder({
        db: fakeDb({}).db,
        provider: failing,
        userId: USER,
        planId: "plus_1m",
      }),
    ).toEqual({ ok: false, reason: "failed" });
    expect(
      await createPlusOrder({
        db: fakeDb({ insertError: true }).db,
        provider,
        userId: USER,
        planId: "plus_1m",
      }),
    ).toEqual({ ok: false, reason: "failed" });
  });
});

describe("confirmPayment", () => {
  const good = () => {
    const pay = provider.simulatePayment("order_sim_1");
    return {
      providerOrderId: "order_sim_1",
      paymentId: pay.paymentId,
      signature: pay.signature,
    };
  };

  it("never asks the database to grant anything when the signature is wrong", async () => {
    const { db, rpcCalls } = fakeDb({ rpcAnswer: { result: "granted" } });
    const g = good();
    for (const signature of [
      "",
      "0".repeat(64),
      g.signature.slice(0, -1) + "0x",
    ]) {
      const out = await confirmPayment({
        db,
        provider,
        userId: USER,
        ...g,
        signature,
      });
      expect(out).toEqual({ ok: false, reason: "bad_signature" });
    }
    // A genuine signature for a different payment id is also a bad signature.
    const out = await confirmPayment({
      db,
      provider,
      userId: USER,
      ...g,
      paymentId: "pay_other",
    });
    expect(out).toEqual({ ok: false, reason: "bad_signature" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("grants through the database function, passing the member id from the session", async () => {
    const { db, rpcCalls } = fakeDb({
      rpcAnswer: { result: "granted", plus_until: "2027-01-01T00:00:00Z" },
    });
    const out = await confirmPayment({ db, provider, userId: USER, ...good() });
    expect(out).toEqual({
      ok: true,
      alreadyGranted: false,
      plusUntil: "2027-01-01T00:00:00Z",
    });
    expect(rpcCalls[0][0]).toBe("grant_plus");
    expect(rpcCalls[0][1]).toMatchObject({
      p_provider_order_id: "order_sim_1",
      p_expected_user: USER,
      p_source: "callback",
    });
  });

  it("treats a repeat as success without a second grant", async () => {
    const { db } = fakeDb({
      rpcAnswer: {
        result: "already_granted",
        plus_until: "2027-01-01T00:00:00Z",
      },
    });
    const out = await confirmPayment({ db, provider, userId: USER, ...good() });
    expect(out).toMatchObject({ ok: true, alreadyGranted: true });
  });

  it("rejects someone else's order, a wrong amount and an unknown order", async () => {
    for (const result of [
      "wrong_user",
      "amount_mismatch",
      "not_found",
      "payment_conflict",
    ]) {
      const { db } = fakeDb({ rpcAnswer: { result } });
      expect(
        await confirmPayment({ db, provider, userId: USER, ...good() }),
      ).toEqual({
        ok: false,
        reason: "rejected",
      });
    }
  });

  it("answers failed when the database call fails or answers nonsense", async () => {
    expect(
      await confirmPayment({
        db: fakeDb({ rpcError: true }).db,
        provider,
        userId: USER,
        ...good(),
      }),
    ).toEqual({ ok: false, reason: "failed" });
    expect(
      await confirmPayment({
        db: fakeDb({ rpcAnswer: { result: "something_new" } }).db,
        provider,
        userId: USER,
        ...good(),
      }),
    ).toEqual({ ok: false, reason: "failed" });
  });
});

describe("applyWebhook", () => {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_1",
          order_id: "order_sim_1",
          amount: 19900,
          currency: "INR",
          status: "captured",
        },
      },
    },
  });
  const sign = (raw: string) => hmacSha256Hex(raw, "unit-webhook-secret");

  it("refuses a missing or wrong signature before reading the body", async () => {
    const { db, rpcCalls } = fakeDb({ rpcAnswer: { result: "granted" } });
    for (const signature of [null, "", "0".repeat(64), sign(body + " ")]) {
      const out = await applyWebhook({
        db,
        provider,
        rawBody: body,
        signature,
      });
      expect(out.status).toBe(400);
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it("grants on a genuine payment.captured, passing the amount and currency to check", async () => {
    const { db, rpcCalls } = fakeDb({
      rpcAnswer: { result: "granted", plus_until: "x" },
    });
    const out = await applyWebhook({
      db,
      provider,
      rawBody: body,
      signature: sign(body),
    });
    expect(out).toEqual({ status: 200, body: { result: "granted" } });
    expect(rpcCalls[0][1]).toMatchObject({
      p_provider_order_id: "order_sim_1",
      p_payment_id: "pay_1",
      p_amount_paise: 19900,
      p_currency: "INR",
      p_source: "webhook",
    });
  });

  it("a replayed webhook gets 200 and the database says already_granted", async () => {
    const { db } = fakeDb({ rpcAnswer: { result: "already_granted" } });
    const out = await applyWebhook({
      db,
      provider,
      rawBody: body,
      signature: sign(body),
    });
    expect(out).toEqual({ status: 200, body: { result: "already_granted" } });
  });

  it("answers 200 (so it is not retried) for an unknown order or a wrong amount, granting nothing", async () => {
    for (const result of [
      "not_found",
      "amount_mismatch",
      "currency_mismatch",
    ]) {
      const { db } = fakeDb({ rpcAnswer: { result } });
      const out = await applyWebhook({
        db,
        provider,
        rawBody: body,
        signature: sign(body),
      });
      expect(out).toEqual({ status: 200, body: { result } });
    }
  });

  it("answers 500 when the database fails, so the sender tries again", async () => {
    const out = await applyWebhook({
      db: fakeDb({ rpcError: true }).db,
      provider,
      rawBody: body,
      signature: sign(body),
    });
    expect(out.status).toBe(500);
  });

  it("ignores genuine events it does not use, and notes failed payments", async () => {
    const other = JSON.stringify({ event: "refund.created", payload: {} });
    const { db, rpcCalls } = fakeDb({});
    expect(
      await applyWebhook({
        db,
        provider,
        rawBody: other,
        signature: sign(other),
      }),
    ).toEqual({
      status: 200,
      body: { result: "ignored" },
    });
    const failed = JSON.stringify({
      event: "payment.failed",
      payload: {
        payment: { entity: { id: "pay_f", order_id: "order_sim_1" } },
      },
    });
    const out = await applyWebhook({
      db,
      provider,
      rawBody: failed,
      signature: sign(failed),
    });
    expect(out.status).toBe(200);
    expect(rpcCalls.map((c) => c[0])).toEqual(["fail_order"]);
  });
});
