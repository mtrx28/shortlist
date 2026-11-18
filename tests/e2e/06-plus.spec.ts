import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PLANS } from "@/config/plans";
import { dropWeekStart, weeksBefore } from "@/lib/matching/week";
import {
  createMember,
  env,
  finishProfile,
  introduce,
  removeMembers,
  service,
  uniq,
  type Member,
} from "../support/stack";
import {
  bodyText,
  expectNoSeriousA11yIssues,
  login,
  openChat,
  pairInOwnCity,
  watchBrowserProblems,
} from "./helpers";

// Buying Plus, start to finish, with the SIMULATED provider (the local test
// setup sets PAYMENT_PROVIDER=simulated). The money paths are the point:
// the right amount, one grant, a tampered callback refused, a replayed webhook
// that changes nothing, and what Plus changes on the screens. One long story,
// one step after another.

test.describe.configure({ mode: "serial" });

const DAY = 24 * 3600 * 1000;
const made: Member[] = [];
let woman: Member;
let buyer: Member; // the man in the pair: he buys Plus
let admin: Member;
let boughtOrder = ""; // our own id of the paid order
let boughtProviderOrder = "";
let boughtUntil = 0;

test.beforeAll(async () => {
  const pair = await pairInOwnCity("Plus");
  woman = pair.woman;
  buyer = pair.man;
  admin = await createMember("Plus Admin", { role: "admin" });
  made.push(woman, buyer, admin);
  await introduce(woman, buyer, dropWeekStart(new Date()));
  // Three open chats, so the free limit of 3 is reached.
  for (let i = 0; i < 3; i++) {
    const other = await createMember(`Plus Friend ${i}`);
    made.push(other);
    await openChat(other, buyer);
  }
});

test.afterAll(async () => removeMembers(made));

// A finished member with nobody else in their city.
async function lonelyMember(name: string, opts: { demo?: boolean } = {}) {
  const m = await createMember(name, opts);
  made.push(m);
  await finishProfile(m, {
    gender: "man",
    interestedIn: ["woman"],
    city: uniq("Soloville"),
  });
  return m;
}

const plusUntil = async (m: Member) => {
  const { data } = await service
    .from("profiles")
    .select("plus_until")
    .eq("id", m.id)
    .single();
  return data?.plus_until ? new Date(data.plus_until).getTime() : null;
};

test("a free member at the cap sees the paywall with a TEST MODE ribbon and the same limits as everyone", async ({
  page,
}) => {
  const watch = watchBrowserProblems(page);
  await login(page, buyer, "/shortlist");
  await expect(page.getByText("3 of 3 chats open").first()).toBeVisible();
  await expect(page.getByRole("status").first()).toContainText(
    /most you can have at once/,
  );
  await expect(page.getByTestId("match-detail")).toHaveCount(0);
  await expect(page.getByText("shows the full breakdown")).toBeVisible();

  await page.goto("/plus");
  await expect(
    page.getByRole("heading", { name: "Shortlist Plus" }),
  ).toBeVisible();
  const ribbon = page.getByTestId("mode-ribbon");
  await expect(ribbon).toBeVisible();
  await expect(ribbon).toContainText("TEST MODE");
  await expect(ribbon).toContainText("SIMULATED");

  const text = await bodyText(page);
  expect(text).toContain("Rs 199");
  expect(text).toContain("Rs 499");
  expect(text).toMatch(/18% GST/);
  expect(text).toMatch(/does not renew by itself/);
  expect(text).toMatch(/never charge for/i);
  expect(text).toMatch(/Reporting and blocking anyone/);
  await expectNoSeriousA11yIssues(page, "/plus");
  expect(watch.problems).toEqual([]);
});

test("the simulated checkout grants 30 days of Plus exactly once", async ({
  page,
}) => {
  const watch = watchBrowserProblems(page);
  await login(page, buyer, "/plus");
  await page.getByRole("button", { name: /Get Plus for 1 month/ }).click();

  await page.waitForURL(/\/plus\/checkout\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("mode-ribbon")).toContainText("SIMULATED");
  await expect(page.getByText("Rs 199")).toBeVisible();
  await expectNoSeriousA11yIssues(page, "/plus/checkout");

  const before = Date.now();
  await page.getByRole("button", { name: /Pay \(simulated/ }).click();
  await page.waitForURL(/\/plus\/success\?order=/);
  await expect(page.getByRole("heading", { name: "Plus is on" })).toBeVisible();
  await expect(page.getByText(/chats open at once/).first()).toBeVisible();

  boughtUntil = (await plusUntil(buyer))!;
  expect(boughtUntil).toBeGreaterThan(before + 29 * DAY);
  expect(boughtUntil).toBeLessThan(Date.now() + 31 * DAY);

  const { data: orders } = await service
    .from("orders")
    .select(
      "id, status, plan, amount_paise, provider, razorpay_order_id, razorpay_payment_id",
    )
    .eq("user_id", buyer.id);
  expect(orders).toHaveLength(1);
  expect(orders![0]).toMatchObject({
    status: "paid",
    plan: "plus_1m",
    amount_paise: PLANS.plus_1m.amountPaise,
    provider: "simulated",
  });
  expect(orders![0].razorpay_payment_id).toMatch(/^pay_sim_/);
  boughtOrder = orders![0].id as string;
  boughtProviderOrder = orders![0].razorpay_order_id as string;

  // Reloading the success page, or visiting the finished checkout again,
  // grants nothing more.
  await page.reload();
  await page.goto(`/plus/checkout/${boughtOrder}`);
  await expect(page.getByText("already paid")).toBeVisible();
  expect(await plusUntil(buyer)).toBe(boughtUntil);
  expect(watch.problems).toEqual([]);
});

test("Plus changes the screens: 5 chats, no cap notice, and the full why-we-matched", async ({
  page,
}) => {
  await login(page, buyer, "/shortlist");
  await expect(page.getByText("3 of 5 chats open").first()).toBeVisible();
  await expect(page.getByText(/most you can have at once/)).toHaveCount(0);
  const detail = page.getByTestId("match-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(/You answered alike on \d+ of \d+ topics/);
  await expect(detail).toContainText("Interests");

  await page.goto("/plus");
  await expect(page.getByRole("status").first()).toContainText(
    "You have Plus until",
  );
  await page.goto("/home");
  await expect(page.getByRole("link", { name: "Your Plus" })).toBeVisible();
});

test("a replayed webhook for a paid order changes nothing", async ({
  request,
}) => {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_replayed_elsewhere",
          order_id: boughtProviderOrder,
          amount: PLANS.plus_1m.amountPaise,
          currency: "INR",
          status: "captured",
        },
      },
    },
  });
  const signature = createHmac("sha256", env.webhookSecret)
    .update(body)
    .digest("hex");
  for (let i = 0; i < 3; i++) {
    const res = await request.post("/api/webhooks/razorpay", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
      },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).result).toBe("already_granted");
  }
  // And an unsigned or wrongly signed one is refused.
  const bad = await request.post("/api/webhooks/razorpay", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": "0".repeat(64),
    },
  });
  expect(bad.status()).toBe(400);
  expect(await plusUntil(buyer)).toBe(boughtUntil);
});

test("a tampered success callback is refused and nothing is granted", async ({
  page,
}) => {
  const victim = await lonelyMember("Plus Tamper");
  await login(page, victim, "/plus");
  await page.getByRole("button", { name: /Get Plus for 3 months/ }).click();
  await page.waitForURL(/\/plus\/checkout\//);

  // Change the signature in the page before pressing Pay.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[name="razorpay_signature"]',
    )!;
    input.value = "0".repeat(64);
  });
  await page.getByRole("button", { name: /Pay \(simulated/ }).click();
  await page.waitForURL(/\/plus\/failed\?why=signature/);
  await expect(
    page.getByRole("heading", { name: "Plus was not turned on" }),
  ).toBeVisible();
  await expect(page.getByText(/could not verify that payment/)).toBeVisible();
  await expectNoSeriousA11yIssues(page, "/plus/failed");

  expect(await plusUntil(victim)).toBeNull();
  const { data } = await service
    .from("orders")
    .select("status, amount_paise")
    .eq("user_id", victim.id);
  expect(data).toEqual([
    { status: "created", amount_paise: PLANS.plus_3m.amountPaise },
  ]);

  // Someone else cannot open or pay another member's checkout page.
  await page.context().clearCookies();
  await login(page, woman, "/home");
  const { data: theirs } = await service
    .from("orders")
    .select("id")
    .eq("user_id", victim.id)
    .single();
  const res = await page.goto(`/plus/checkout/${theirs!.id}`);
  expect(res?.status()).toBe(404);
});

test("a failed simulated payment ends on the failed page and Plus stays off", async ({
  page,
}) => {
  const loser = await lonelyMember("Plus Fail");
  await login(page, loser, "/plus");
  await page.getByRole("button", { name: /Get Plus for 1 month/ }).click();
  await page.waitForURL(/\/plus\/checkout\//);
  await page.getByRole("button", { name: "Simulate a failed payment" }).click();
  await page.waitForURL(/\/plus\/failed/);
  await expect(page.getByText(/did not go through/)).toBeVisible();
  expect(await plusUntil(loser)).toBeNull();
  const { data } = await service
    .from("orders")
    .select("status")
    .eq("user_id", loser.id);
  expect(data).toEqual([{ status: "failed" }]);
});

test("an admin sees the orders, with masked ids and the stats, and can revoke Plus", async ({
  page,
}) => {
  await login(page, admin, "/admin");
  await expect(page.getByTestId("orders-stats")).toContainText("Paid");
  await expect(page.getByTestId("orders-stats")).toContainText("Conversion");
  await expectNoSeriousA11yIssues(page, "/admin (with orders)");

  await page.goto("/admin/orders");
  await expectNoSeriousA11yIssues(page, "/admin/orders");
  const text = await bodyText(page);
  expect(text).toContain("simulated");
  // The full provider order id is never printed.
  expect(text).not.toContain(boughtProviderOrder);
  expect(text).toContain(
    `${boughtProviderOrder.slice(0, 7)}...${boughtProviderOrder.slice(-4)}`,
  );

  // Revoke the buyer's Plus (the row whose masked order id we know).
  const row = page.getByRole("row").filter({
    hasText: `${boughtProviderOrder.slice(0, 7)}...${boughtProviderOrder.slice(-4)}`,
  });
  await row.getByRole("button", { name: "Revoke Plus" }).click();
  await expect(page.getByRole("status")).toContainText("Plus was taken away");
  expect((await plusUntil(buyer))!).toBeLessThanOrEqual(Date.now());
  const { data: audit } = await service
    .from("audit_log")
    .select("action, target")
    .eq("target", `profile:${buyer.id}`);
  expect(audit).toEqual([
    { action: "plus_revoked", target: `profile:${buyer.id}` },
  ]);
});

test("after Plus ends the cap is 3 again, and nothing already open is closed", async ({
  page,
}) => {
  await login(page, buyer, "/shortlist");
  await expect(page.getByText("3 of 3 chats open").first()).toBeVisible();
  const { data: chats } = await service
    .from("conversations")
    .select("id")
    .eq("user_b", buyer.id)
    .in("status", ["open", "kept"]);
  expect(chats).toHaveLength(3);
  await expect(page.getByTestId("match-detail")).toHaveCount(0);
});

test("demo accounts can grant themselves 30 days, and real members cannot", async ({
  page,
}) => {
  const demo = await lonelyMember("Plus Demo", { demo: true });
  await login(page, demo, "/plus");
  await page.getByRole("button", { name: /Grant me 30 days of Plus/ }).click();
  await expect(
    page.getByText(/Plus switched on for 30 more days/),
  ).toBeVisible();
  expect((await plusUntil(demo))!).toBeGreaterThan(Date.now() + 29 * DAY);

  // The buyer is not a demo account: no controls on the page.
  await page.context().clearCookies();
  await login(page, buyer, "/plus");
  await expect(
    page.getByRole("button", { name: /Grant me 30 days/ }),
  ).toHaveCount(0);
});

test("second look: a Plus member brings back an intro they passed on, and a mutual one opens the chat", async ({
  page,
}) => {
  const pair = await pairInOwnCity("Look", { demo: true });
  made.push(pair.woman, pair.man);
  const oldWeek = weeksBefore(dropWeekStart(new Date()), 2);
  const { introOf } = await introduce(pair.woman, pair.man, oldWeek);
  // She passed; he had said Interested in that drop.
  await service
    .from("intros")
    .update({ status: "passed", decided_at: new Date().toISOString() })
    .eq("id", introOf(pair.woman));
  await service
    .from("intros")
    .update({ status: "interested", decided_at: new Date().toISOString() })
    .eq("id", introOf(pair.man));
  await service
    .from("profiles")
    .update({ plus_until: new Date(Date.now() + 30 * DAY).toISOString() })
    .eq("id", pair.woman.id);

  await login(page, pair.woman, "/shortlist");
  const section = page.getByRole("region", {
    name: "Second look",
    exact: true,
  });
  await expect(section).toContainText("Look Man");
  await section
    .getByRole("button", { name: "Take a second look at Look Man" })
    .click();
  await expect(section).toContainText("Brought back");

  const back = page.getByRole("region", {
    name: "Brought back by second look",
  });
  await expect(back).toContainText("Look Man");
  await back
    .getByRole("button", { name: /Interested/ })
    .first()
    .click();
  await expect(page.getByText(/It is mutual/).first()).toBeVisible();

  const { data: chat } = await service
    .from("conversations")
    .select("id")
    .in("user_a", [pair.woman.id, pair.man.id])
    .in("user_b", [pair.woman.id, pair.man.id]);
  expect(chat).toHaveLength(1);

  // Used up: no second one for 30 days.
  await page.goto("/shortlist");
  await expect(
    page.getByRole("region", { name: "Second look", exact: true }),
  ).toContainText(/next one is available on/);
});
