import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLANS } from "@/config/plans";
import { runDrop } from "@/lib/matching/run-drop";
import { SupabaseDropStore } from "@/lib/matching/supabase-store";
import { grantPlus } from "@/lib/payments/service";
import {
  createMember,
  env,
  finishProfile,
  removeMembers,
  service,
  signedInClient,
  uniq,
  type Member,
} from "../support/stack";

// Payments against the real local stack: the database function under true
// parallelism (separate HTTP requests), row level security from a real signed-in
// client, the webhook endpoint over real HTTP with signatures computed here
// from a test-only secret, and the weekly drop giving Plus members 5 intros.

const DAY = 24 * 3600 * 1000;
const made: Member[] = [];
afterAll(async () => removeMembers(made));

async function buyer(prefix: string) {
  const m = await createMember(prefix);
  made.push(m);
  return m;
}

let counter = 0;
async function order(user: Member, plan: "plus_1m" | "plus_3m" = "plus_1m") {
  const providerOrderId = `order_it_${Date.now()}_${++counter}`;
  const { error } = await service.from("orders").insert({
    user_id: user.id,
    razorpay_order_id: providerOrderId,
    plan,
    amount_paise: PLANS[plan].amountPaise,
    days: PLANS[plan].days,
    provider: "simulated",
  });
  if (error) throw new Error(error.message);
  return providerOrderId;
}

const plusUntil = async (user: Member) => {
  const { data } = await service
    .from("profiles")
    .select("plus_until")
    .eq("id", user.id)
    .single();
  return data?.plus_until ? new Date(data.plus_until).getTime() : null;
};

describe("grant_plus under parallel requests", () => {
  it("8 parallel calls for one order grant exactly once", async () => {
    const user = await buyer("Race");
    const o = await order(user);
    const before = Date.now();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        grantPlus(service, {
          providerOrderId: o,
          paymentId: "pay_it_race",
          expectedUser: user.id,
          // Half arrive "from the browser", half "from the webhook".
          source: i % 2 ? "webhook" : "callback",
        }),
      ),
    );
    expect(results.every((r) => r !== null)).toBe(true);
    expect(results.filter((r) => r?.result === "granted")).toHaveLength(1);
    expect(results.filter((r) => r?.result === "already_granted")).toHaveLength(
      7,
    );

    const until = (await plusUntil(user))!;
    expect(until).toBeGreaterThanOrEqual(before + 30 * DAY - 5000);
    expect(until).toBeLessThanOrEqual(Date.now() + 30 * DAY + 5000);

    const { data: events } = await service
      .from("events")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", "plus_granted");
    expect(events).toHaveLength(1);
  });

  it("two different orders paid at the same moment add up (no lost update)", async () => {
    const user = await buyer("Stack");
    const a = await order(user, "plus_1m");
    const b = await order(user, "plus_3m");
    const [ra, rb] = await Promise.all([
      grantPlus(service, {
        providerOrderId: a,
        paymentId: "pay_it_a",
        source: "callback",
      }),
      grantPlus(service, {
        providerOrderId: b,
        paymentId: "pay_it_b",
        source: "webhook",
      }),
    ]);
    expect([ra?.result, rb?.result]).toEqual(["granted", "granted"]);
    const until = (await plusUntil(user))!;
    expect(until).toBeGreaterThan(Date.now() + 119 * DAY);
    expect(until).toBeLessThan(Date.now() + 121 * DAY);
  });

  it("refuses the wrong user, the wrong amount and an unknown order over HTTP", async () => {
    const owner = await buyer("Owner");
    const other = await buyer("Other");
    const o = await order(owner);
    const wrongUser = await grantPlus(service, {
      providerOrderId: o,
      paymentId: "pay_it_x1",
      expectedUser: other.id,
      source: "callback",
    });
    const wrongAmount = await grantPlus(service, {
      providerOrderId: o,
      paymentId: "pay_it_x2",
      amountPaise: 100,
      source: "webhook",
    });
    const unknown = await grantPlus(service, {
      providerOrderId: "order_does_not_exist",
      paymentId: "pay_it_x3",
      source: "webhook",
    });
    expect(wrongUser?.result).toBe("wrong_user");
    expect(wrongAmount?.result).toBe("amount_mismatch");
    expect(unknown?.result).toBe("not_found");
    expect(await plusUntil(owner)).toBeNull();
    expect(await plusUntil(other)).toBeNull();
  });
});

describe("row level security from a real signed-in client", () => {
  it("cannot write orders or plus_until, cannot call the money functions, can read own orders", async () => {
    const user = await buyer("Rls");
    const other = await buyer("RlsOther");
    const mine = await order(user);
    await order(other);

    const client = await signedInClient(user);
    const insert = await client.from("orders").insert({
      user_id: user.id,
      razorpay_order_id: "order_self_made",
      plan: "plus_1m",
      amount_paise: 1,
    });
    expect(insert.error).toBeTruthy();

    const markPaid = await client
      .from("orders")
      .update({ status: "paid" })
      .eq("razorpay_order_id", mine);
    expect(markPaid.error).toBeTruthy();

    const self = await client
      .from("profiles")
      .update({ plus_until: new Date(Date.now() + 365 * DAY).toISOString() })
      .eq("id", user.id);
    expect(self.error).toBeTruthy();
    expect(await plusUntil(user)).toBeNull();

    for (const [fn, args] of [
      ["grant_plus", { p_provider_order_id: mine, p_payment_id: "pay_self" }],
      ["fail_order", { p_provider_order_id: mine, p_expected_user: null }],
      ["grant_demo_plus", { p_user: user.id, p_days: 30 }],
      ["revoke_plus", { p_admin: user.id, p_target: user.id }],
      ["use_second_look", { p_user: user.id, p_intro: randomUUID() }],
    ] as const) {
      const { error } = await client.rpc(fn, args);
      expect(error, `${fn} should not be callable`).toBeTruthy();
    }
    expect(await plusUntil(user)).toBeNull();

    const { data: visible } = await client
      .from("orders")
      .select("razorpay_order_id");
    expect(visible?.map((r) => r.razorpay_order_id)).toEqual([mine]);
  });
});

// ---------------------------------------------------------------------------
// The webhook endpoint over real HTTP
// ---------------------------------------------------------------------------
describe("POST /api/webhooks/razorpay", () => {
  let appUp = false;
  beforeAll(async () => {
    try {
      appUp = (await fetch(env.appUrl + "/api/health")).ok;
    } catch {
      appUp = false;
    }
    if (!appUp) {
      console.warn(
        `SKIPPED webhook HTTP tests: the app is not running at ${env.appUrl}`,
      );
    }
  });

  const sign = (body: string, secret = env.webhookSecret) =>
    createHmac("sha256", secret).update(body).digest("hex");
  const captured = (orderId: string, paymentId: string, amount: number) =>
    JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount,
            currency: "INR",
            status: "captured",
          },
        },
      },
    });
  const post = (body: string, signature: string | null) =>
    fetch(env.appUrl + "/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-razorpay-signature": signature } : {}),
      },
      body,
    });

  it("grants Plus for a valid signature, and a replay changes nothing", async (ctx) => {
    if (!appUp) return ctx.skip();
    const user = await buyer("Hook");
    const o = await order(user, "plus_3m");
    const body = captured(o, "pay_it_hook", PLANS.plus_3m.amountPaise);

    const first = await post(body, sign(body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: "granted" });
    const until = await plusUntil(user);
    expect(until).toBeGreaterThan(Date.now() + 89 * DAY);

    for (let i = 0; i < 3; i++) {
      const again = await post(body, sign(body));
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ result: "already_granted" });
    }
    expect(await plusUntil(user)).toBe(until);
    const { data: rows } = await service
      .from("orders")
      .select("status, razorpay_payment_id")
      .eq("razorpay_order_id", o);
    expect(rows).toEqual([
      { status: "paid", razorpay_payment_id: "pay_it_hook" },
    ]);
  });

  it("rejects a wrong, missing, malformed or other-body signature with 400 and grants nothing", async (ctx) => {
    if (!appUp) return ctx.skip();
    const user = await buyer("HookBad");
    const o = await order(user);
    const body = captured(o, "pay_it_bad", PLANS.plus_1m.amountPaise);
    const otherBody = captured(o, "pay_it_bad2", PLANS.plus_1m.amountPaise);

    for (const signature of [
      null,
      "",
      "not-hex",
      "0".repeat(64),
      sign(body, "the-wrong-secret"),
      sign(otherBody), // genuine signature, but of a different body
      sign(body).toUpperCase().slice(0, 63),
    ]) {
      const res = await post(body, signature);
      expect(res.status, `signature ${String(signature).slice(0, 12)}`).toBe(
        400,
      );
    }
    // The body with one extra space no longer matches its own signature.
    expect((await post(body + " ", sign(body))).status).toBe(400);
    expect(await plusUntil(user)).toBeNull();
    const { data } = await service
      .from("orders")
      .select("status")
      .eq("razorpay_order_id", o)
      .single();
    expect(data?.status).toBe("created");
  });

  it("answers 200 and grants nothing for an unknown order or a wrong amount", async (ctx) => {
    if (!appUp) return ctx.skip();
    const user = await buyer("HookMismatch");
    const o = await order(user);

    const unknown = captured("order_unknown_it", "pay_it_u", 19900);
    const r1 = await post(unknown, sign(unknown));
    expect(r1.status).toBe(200);
    expect((await r1.json()).result).toBe("not_found");

    const cheap = captured(o, "pay_it_cheap", 100);
    const r2 = await post(cheap, sign(cheap));
    expect(r2.status).toBe(200);
    expect((await r2.json()).result).toBe("amount_mismatch");
    expect(await plusUntil(user)).toBeNull();
  });

  it("marks a failed payment, which a later successful payment on the same order overrides", async (ctx) => {
    if (!appUp) return ctx.skip();
    const user = await buyer("HookFail");
    const o = await order(user);
    const failed = JSON.stringify({
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_it_f",
            order_id: o,
            error_description: "Declined",
          },
        },
      },
    });
    expect((await post(failed, sign(failed))).status).toBe(200);
    const { data } = await service
      .from("orders")
      .select("status, failure_reason")
      .eq("razorpay_order_id", o)
      .single();
    expect(data).toEqual({ status: "failed", failure_reason: "Declined" });

    const ok = captured(o, "pay_it_f2", PLANS.plus_1m.amountPaise);
    expect((await post(ok, sign(ok))).status).toBe(200);
    expect(await plusUntil(user)).not.toBeNull();
  });

  it("ignores an event it does not use, and refuses a body that is not a webhook", async (ctx) => {
    if (!appUp) return ctx.skip();
    const refund = JSON.stringify({ event: "refund.created", payload: {} });
    const res = await post(refund, sign(refund));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ignored" });
    const garbage = "this is not json";
    const g = await post(garbage, sign(garbage));
    expect(g.status).toBe(200); // genuine signature, nothing to act on
    expect(await g.json()).toEqual({ result: "ignored" });
  });
});

// ---------------------------------------------------------------------------
// Plus changes what the weekly drop gives
// ---------------------------------------------------------------------------
describe("the weekly drop and Plus", () => {
  // A week far in the future so no other test's drop is in the way.
  const NOW = new Date("2031-03-12T10:00:00Z");
  const WEEK = "2031-03-10";
  afterAll(async () => {
    await service.from("drops").delete().eq("week_start", WEEK);
  });

  it("gives a Plus member 5 intros and a free member 3, from the same pool", async () => {
    // Two cities, so the two women never compete for the same men: six men
    // for the Plus member, four for the free one.
    const city = uniq("Plusville");
    const city2 = uniq("Freeville");
    const plusWoman = await buyer("PlusW");
    const freeWoman = await buyer("FreeW");
    await finishProfile(plusWoman, {
      gender: "woman",
      interestedIn: ["man"],
      city,
    });
    await finishProfile(freeWoman, {
      gender: "woman",
      interestedIn: ["man"],
      city: city2,
    });
    for (let i = 0; i < 10; i++) {
      const man = await buyer(`Man${i}`);
      await finishProfile(man, {
        gender: "man",
        interestedIn: ["woman"],
        city: i < 6 ? city : city2,
      });
    }

    // Plus is switched on the way a payment does it.
    const o = await order(plusWoman);
    // Granted "as of" the simulated drop day, so Plus is still running then.
    await grantPlus(service, {
      providerOrderId: o,
      paymentId: "pay_it_drop",
      source: "webhook",
      now: NOW,
    });

    const outcome = await runDrop(new SupabaseDropStore(service), {
      now: NOW,
      source: "cron",
    });
    expect(outcome.status).toBe("created");

    const count = async (viewer: Member) => {
      const { data } = await service
        .from("intros")
        .select("id")
        .eq("viewer_id", viewer.id);
      return data?.length ?? 0;
    };
    expect(await count(plusWoman)).toBe(5);
    expect(await count(freeWoman)).toBe(3);
  });
});
