import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RazorpayProvider } from "@/lib/payments/razorpay";
import {
  PaymentConfigError,
  getPaymentProvider,
  modeLabel,
} from "@/lib/payments/select";
import { SimulatedProvider } from "@/lib/payments/simulated";
import { parseRazorpayWebhook } from "@/lib/payments/webhook";

const SERVER = "server-only-value-for-tests";
const TEST_ENV = {
  RAZORPAY_KEY_ID: "rzp_test_abc123",
  RAZORPAY_KEY_SECRET: "secret_for_tests",
  RAZORPAY_WEBHOOK_SECRET: "whsec_for_tests",
  SUPABASE_SERVICE_ROLE_KEY: SERVER,
};

describe("provider selection", () => {
  it("uses the simulated checkout when no Razorpay key is set", () => {
    const p = getPaymentProvider({ SUPABASE_SERVICE_ROLE_KEY: SERVER });
    expect(p.name).toBe("simulated");
    expect(p.mode).toBe("simulated");
  });

  it("uses Razorpay test mode when both keys are a test pair", () => {
    const p = getPaymentProvider(TEST_ENV);
    expect(p.name).toBe("razorpay");
    expect(p.mode).toBe("test");
    // The browser may see the key id, nothing else.
    expect(p.publicConfig()).toEqual({ keyId: "rzp_test_abc123" });
  });

  it("PAYMENT_PROVIDER=simulated wins even when keys exist", () => {
    const p = getPaymentProvider({
      ...TEST_ENV,
      PAYMENT_PROVIDER: "simulated",
    });
    expect(p.name).toBe("simulated");
  });

  it("fails loudly when only one of the two keys is set (never a silent fall back)", () => {
    for (const env of [
      { RAZORPAY_KEY_ID: "rzp_test_abc", SUPABASE_SERVICE_ROLE_KEY: SERVER },
      { RAZORPAY_KEY_SECRET: "s", SUPABASE_SERVICE_ROLE_KEY: SERVER },
    ]) {
      expect(() =>
        getPaymentProvider({ ...env, NODE_ENV: "production" }),
      ).toThrow(PaymentConfigError);
      expect(() =>
        getPaymentProvider({ ...env, NODE_ENV: "development" }),
      ).toThrow(PaymentConfigError);
    }
  });

  it("PAYMENT_PROVIDER=razorpay without keys is an error, not the simulated checkout", () => {
    expect(() =>
      getPaymentProvider({
        PAYMENT_PROVIDER: "razorpay",
        SUPABASE_SERVICE_ROLE_KEY: SERVER,
      }),
    ).toThrow(PaymentConfigError);
  });

  it("refuses a live key unless ALLOW_LIVE_PAYMENTS is exactly true", () => {
    const live = {
      ...TEST_ENV,
      RAZORPAY_KEY_ID: "rzp_live_abc123",
    };
    expect(() => getPaymentProvider(live)).toThrow(/live/i);
    expect(() =>
      getPaymentProvider({ ...live, ALLOW_LIVE_PAYMENTS: "false" }),
    ).toThrow();
    expect(() =>
      getPaymentProvider({ ...live, ALLOW_LIVE_PAYMENTS: "TRUE" }),
    ).toThrow();
    expect(() =>
      getPaymentProvider({ ...live, ALLOW_LIVE_PAYMENTS: "1" }),
    ).toThrow();
    expect(
      getPaymentProvider({ ...live, ALLOW_LIVE_PAYMENTS: "true" }).mode,
    ).toBe("live");
  });

  it("refuses a key id that is neither test nor live, and an unknown provider name", () => {
    expect(() =>
      getPaymentProvider({ ...TEST_ENV, RAZORPAY_KEY_ID: "something_else" }),
    ).toThrow(PaymentConfigError);
    expect(() =>
      getPaymentProvider({ ...TEST_ENV, PAYMENT_PROVIDER: "stripe" }),
    ).toThrow(PaymentConfigError);
  });

  it("the simulated provider needs a server secret to derive its keys from", () => {
    expect(() => getPaymentProvider({})).toThrow(PaymentConfigError);
  });

  it("shows the TEST MODE ribbon for simulated and test, and none for live", () => {
    expect(
      modeLabel(getPaymentProvider({ SUPABASE_SERVICE_ROLE_KEY: SERVER }))
        .ribbon,
    ).toMatch(/TEST MODE/);
    expect(modeLabel(getPaymentProvider(TEST_ENV)).ribbon).toMatch(/TEST MODE/);
    const live = getPaymentProvider({
      ...TEST_ENV,
      RAZORPAY_KEY_ID: "rzp_live_x",
      ALLOW_LIVE_PAYMENTS: "true",
    });
    expect(modeLabel(live).ribbon).toBeNull();
  });
});

describe("RazorpayProvider", () => {
  const make = (fetchImpl: typeof fetch) =>
    new RazorpayProvider(
      "rzp_test_key",
      "the_secret",
      "whsec",
      "test",
      fetchImpl,
    );

  it("creates an order with basic auth and the amount we chose", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "order_123",
          amount: sent.amount,
          currency: sent.currency,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const order = await make(fetchImpl).createOrder({
      amountPaise: 19900,
      currency: "INR",
      receipt: "r1",
      notes: { plan: "plus_1m" },
    });
    expect(order).toEqual({
      id: "order_123",
      amountPaise: 19900,
      currency: "INR",
    });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("rzp_test_key:the_secret").toString("base64")}`,
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 19900,
      currency: "INR",
    });
  });

  it("throws (without leaking the secret) when Razorpay refuses or answers oddly", async () => {
    const refuse = (async () =>
      new Response("bad keys", { status: 401 })) as unknown as typeof fetch;
    await expect(
      make(refuse).createOrder({
        amountPaise: 100,
        currency: "INR",
        receipt: "r",
        notes: {},
      }),
    ).rejects.toThrow(/refused/);
    const wrongAmount = (async () =>
      new Response(
        JSON.stringify({ id: "order_1", amount: 1, currency: "INR" }),
        {
          status: 200,
        },
      )) as unknown as typeof fetch;
    await expect(
      make(wrongAmount).createOrder({
        amountPaise: 100,
        currency: "INR",
        receipt: "r",
        notes: {},
      }),
    ).rejects.toThrow(/did not expect/);
    try {
      await make(refuse).createOrder({
        amountPaise: 100,
        currency: "INR",
        receipt: "r",
        notes: {},
      });
    } catch (e) {
      expect(String(e)).not.toContain("the_secret");
    }
  });

  it("verifies callbacks and webhooks with its own secrets", () => {
    const p = make(fetch);
    const sig = createHmac("sha256", "the_secret")
      .update("order_1|pay_1")
      .digest("hex");
    expect(
      p.verifyPayment({
        orderId: "order_1",
        paymentId: "pay_1",
        signature: sig,
      }),
    ).toBe(true);
    expect(
      p.verifyPayment({
        orderId: "order_1",
        paymentId: "pay_2",
        signature: sig,
      }),
    ).toBe(false);
    const body = '{"event":"x"}';
    const wsig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(p.verifyWebhook(body, wsig)).toBe(true);
    expect(p.verifyWebhook(body, sig)).toBe(false);
  });

  it("verifies no webhook at all when no webhook secret is set", () => {
    const p = new RazorpayProvider("rzp_test_key", "s", null, "test");
    const body = "{}";
    expect(
      p.verifyWebhook(
        body,
        createHmac("sha256", "").update(body).digest("hex"),
      ),
    ).toBe(false);
  });
});

describe("SimulatedProvider", () => {
  it("makes an order locally and signs a payment that its own verifier accepts", async () => {
    const p = new SimulatedProvider(SERVER);
    const order = await p.createOrder({
      amountPaise: 19900,
      currency: "INR",
      receipt: "r",
      notes: {},
    });
    expect(order.id).toMatch(/^order_sim_/);
    const pay = p.simulatePayment(order.id);
    expect(p.verifyPayment({ orderId: order.id, ...pay })).toBe(true);
    expect(
      p.verifyPayment({
        orderId: order.id,
        paymentId: pay.paymentId,
        signature: "0".repeat(64),
      }),
    ).toBe(false);
    // A signature made by another server's secret does not pass.
    const other = new SimulatedProvider("another-server");
    expect(
      p.verifyPayment({
        orderId: order.id,
        ...other.simulatePayment(order.id),
      }),
    ).toBe(false);
  });

  it("uses RAZORPAY_WEBHOOK_SECRET for webhooks when one is given", () => {
    const body = "{}";
    const sig = createHmac("sha256", "test-webhook").update(body).digest("hex");
    expect(
      new SimulatedProvider(SERVER, "test-webhook").verifyWebhook(body, sig),
    ).toBe(true);
    expect(new SimulatedProvider(SERVER).verifyWebhook(body, sig)).toBe(false);
  });
});

describe("parseRazorpayWebhook", () => {
  const captured = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_1",
          order_id: "order_1",
          amount: 19900,
          currency: "INR",
          status: "captured",
        },
      },
    },
  };

  it("reads payment.captured", () => {
    expect(parseRazorpayWebhook(JSON.stringify(captured))).toEqual({
      kind: "paid",
      orderId: "order_1",
      paymentId: "pay_1",
      amountPaise: 19900,
      currency: "INR",
    });
  });

  it("reads order.paid (payment and order both present)", () => {
    const body = {
      event: "order.paid",
      payload: {
        payment: captured.payload.payment,
        order: {
          entity: {
            id: "order_1",
            amount_paid: 19900,
            currency: "INR",
            status: "paid",
          },
        },
      },
    };
    expect(parseRazorpayWebhook(JSON.stringify(body))).toMatchObject({
      kind: "paid",
      orderId: "order_1",
      paymentId: "pay_1",
      amountPaise: 19900,
    });
  });

  it("reads payment.failed", () => {
    const body = {
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_9",
            order_id: "order_1",
            error_description: "Declined",
          },
        },
      },
    };
    expect(parseRazorpayWebhook(JSON.stringify(body))).toEqual({
      kind: "failed",
      orderId: "order_1",
      paymentId: "pay_9",
      reason: "Declined",
    });
  });

  it("ignores other events and refuses broken or incomplete ones", () => {
    expect(
      parseRazorpayWebhook(
        JSON.stringify({ event: "refund.created", payload: {} }),
      ),
    ).toBeNull();
    expect(parseRazorpayWebhook("not json")).toBeNull();
    expect(parseRazorpayWebhook("null")).toBeNull();
    expect(parseRazorpayWebhook("[]")).toBeNull();
    const noAmount = structuredClone(captured) as typeof captured;
    delete (
      noAmount.payload.payment.entity as Partial<
        typeof noAmount.payload.payment.entity
      >
    ).amount;
    expect(parseRazorpayWebhook(JSON.stringify(noAmount))).toBeNull();
    const authorized = structuredClone(captured);
    authorized.payload.payment.entity.status = "authorized";
    expect(parseRazorpayWebhook(JSON.stringify(authorized))).toBeNull();
    const stringAmount = structuredClone(captured) as unknown as {
      payload: { payment: { entity: { amount: unknown } } };
    };
    stringAmount.payload.payment.entity.amount = "19900";
    expect(parseRazorpayWebhook(JSON.stringify(stringAmount))).toBeNull();
  });
});
