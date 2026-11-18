import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  createMember,
  env,
  removeMembers,
  service,
  type Member,
} from "../support/stack";
import {
  login,
  openChat,
  pairInOwnCity,
  watchBrowserProblems,
  watchRealtime,
} from "./helpers";

// The main story, one step after another: the weekly drop run by an admin, the
// woman-first rule, a live chat in two browsers, the decision screen, keep,
// ending a kept chat, closing kindly and expiry. The two people are made in
// the database (the sign-up and onboarding screens have their own test); they
// live in a city of their own so a drop can only pair them with each other.

test.describe.configure({ mode: "serial" });

let woman: Member;
let man: Member;
let admin: Member;
let chatId = "";
const made: Member[] = [];

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  return context.newPage();
}

test.beforeAll(async () => {
  const pair = await pairInOwnCity("Flow", { demo: true });
  woman = pair.woman;
  man = pair.man;
  admin = await createMember("Flow Admin", { role: "admin" });
  made.push(woman, man, admin);
});

test.afterAll(async () => {
  await removeMembers(made);
});

test("an admin runs the weekly drop and both people get each other", async ({
  page,
}) => {
  const watch = watchBrowserProblems(page);
  await login(page, admin, "/admin/drop");
  // Replace this week's drop if an earlier run already made one (only allowed
  // while nobody has answered an intro, which is true on a fresh database).
  await page.getByLabel(/rebuild/i).check();
  await page.getByRole("button", { name: "Run drop now" }).click();
  await expect(page.getByRole("status")).toContainText(/drop/i);

  const { data } = await service
    .from("intros")
    .select("viewer_id, candidate_id")
    .in("viewer_id", [woman.id, man.id]);
  expect(data).toHaveLength(2);
  expect(data!.find((r) => r.viewer_id === woman.id)?.candidate_id).toBe(
    man.id,
  );
  expect(data!.find((r) => r.viewer_id === man.id)?.candidate_id).toBe(
    woman.id,
  );
  expect(watch.problems).toEqual([]);
});

test("woman-first: the man's yes waits, her yes opens the chat and she writes first", async ({
  browser,
}) => {
  const manPage = await newPage(browser);
  const womanPage = await newPage(browser);
  await login(manPage, man, "/shortlist");
  await login(womanPage, woman, "/shortlist");

  await expect(
    manPage.getByRole("heading", { name: "Woman", exact: false }).first(),
  ).toBeVisible();
  await manPage
    .getByLabel("Add a short note (optional)")
    .fill("Fan of your Sunday plans");
  await manPage.getByRole("button", { name: "Interested" }).click();
  await expect(manPage.getByRole("status")).toContainText("Interest saved");
  // His yes alone opened nothing.
  const none = await service
    .from("conversations")
    .select("id")
    .in("user_a", [woman.id, man.id]);
  expect(none.data).toHaveLength(0);

  await womanPage.getByRole("button", { name: "Interested" }).click();
  await expect(
    womanPage.getByText(/chat (is )?open|chat opened|Go to Chats/i).first(),
  ).toBeVisible();

  const { data } = await service
    .from("conversations")
    .select("id, opener_id, status")
    .in("user_a", [woman.id, man.id]);
  expect(data).toHaveLength(1);
  expect(data![0].opener_id).toBe(woman.id);
  chatId = data![0].id as string;
  await manPage.context().close();
  await womanPage.context().close();
});

test("a live chat: messages arrive on the other screen at once, with a phone-number warning and a rate limit", async ({
  browser,
}) => {
  const womanPage = await newPage(browser);
  const manPage = await newPage(browser);
  const watchW = watchBrowserProblems(womanPage);
  const liveW = watchRealtime(womanPage);
  const liveM = watchRealtime(manPage);
  await login(womanPage, woman, `/chat/${chatId}`);
  await login(manPage, man, `/chat/${chatId}`);

  // The man's browser opens a Realtime WebSocket to the local stack.
  const socketOpened = manPage.waitForEvent("websocket", (ws) =>
    ws.url().includes("/realtime/"),
  );
  await manPage.reload();
  await socketOpened;
  await expect(manPage.getByText("Their note:", { exact: false })).toHaveCount(
    0,
  ); // she wrote no note

  // First message contains a phone number: a warning dialog first.
  const box = womanPage.getByLabel(/Message to/);
  await box.fill("Hi! Text me on 9876543210 maybe");
  await womanPage.getByRole("button", { name: "Send", exact: true }).click();
  const dialog = womanPage.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "Are you sure? Keep early chats in the app.",
  );
  await dialog.getByRole("button", { name: "Edit my message" }).click();
  await box.fill("Hi! I loved your answer about Sundays.");
  await womanPage.getByRole("button", { name: "Send", exact: true }).click();
  await expect(womanPage.getByRole("log")).toContainText(
    "I loved your answer about Sundays",
  );

  // Realtime: it shows on his screen within a few seconds, far below the
  // 20 second polling safety net used while Realtime is connected.
  await expect(manPage.getByRole("log")).toContainText(
    "I loved your answer about Sundays",
    { timeout: 6000 },
  );
  expect(
    liveM.saw("I loved your answer about Sundays"),
    "reached him through Realtime, not polling",
  ).toBe(true);
  // The moderation flag column must not travel in the payload.
  expect(liveM.frames.some((f) => f.includes("flagged"))).toBe(false);

  // He replies; she sees it at once.
  await manPage
    .getByLabel(/Message to/)
    .fill("Thank you! Sundays are my favourite.");
  await manPage.getByLabel(/Message to/).press("Enter");
  await expect(womanPage.getByRole("log")).toContainText(
    "Sundays are my favourite",
    { timeout: 6000 },
  );
  expect(
    liveW.saw("Sundays are my favourite"),
    "reached her through Realtime, not polling",
  ).toBe(true);

  // A message with a number as her FIRST message was never sent, so nothing
  // was flagged yet. Send a number as a later message: no dialog (only first).
  // Rate limit: 8 a minute. She has sent 1; the 8th more is refused.
  let limited = false;
  for (let i = 0; i < 9 && !limited; i++) {
    await box.fill(`quick message ${i}`);
    await box.press("Enter");
    limited = await womanPage
      .getByText("You are sending messages very quickly")
      .isVisible()
      .catch(() => false);
    if (!limited) await womanPage.waitForTimeout(150);
  }
  await expect(
    womanPage.getByText("You are sending messages very quickly"),
  ).toBeVisible();

  expect(watchW.problems).toEqual([]);
  await womanPage.context().close();
  await manPage.context().close();
});

test("a demo fast-forward opens the day-3 choice; both keep, and the chat is kept", async ({
  browser,
}) => {
  const womanPage = await newPage(browser);
  const manPage = await newPage(browser);
  await login(womanPage, woman, `/chat/${chatId}`);
  await login(manPage, man, `/chat/${chatId}`);

  await womanPage.getByRole("button", { name: /Jump to day 3/ }).click();
  await expect(
    womanPage.getByText("Done. The chat clock was moved."),
  ).toBeVisible();
  await manPage.reload();
  for (const p of [womanPage, manPage]) {
    await p.reload();
    await expect(p.getByRole("button", { name: "Keep talking" })).toBeVisible();
  }
  await womanPage.getByRole("button", { name: "Keep talking" }).click();
  await expect(womanPage.getByText("You chose to keep talking")).toBeVisible();
  await manPage.getByRole("button", { name: "Keep talking" }).click();
  await expect(
    manPage.getByText("You both chose to keep talking"),
  ).toBeVisible();

  const { data } = await service
    .from("conversations")
    .select("status")
    .eq("id", chatId)
    .single();
  expect(data?.status).toBe("kept");
  await womanPage.context().close();
  await manPage.context().close();
});

test("either person can end a kept chat kindly, which frees the slot", async ({
  browser,
}) => {
  const womanPage = await newPage(browser);
  await login(womanPage, woman, `/chat/${chatId}`);
  await womanPage.getByRole("button", { name: /Safety options for/ }).click();
  await womanPage.getByRole("button", { name: "End this chat" }).click();
  await womanPage.getByLabel("Thank you, I wish you well").check();
  await womanPage.getByRole("button", { name: "End this chat" }).last().click();
  await expect(womanPage.getByRole("status")).toContainText(
    "This chat has ended",
  );

  const { data } = await service
    .from("conversations")
    .select("status, closed_by")
    .eq("id", chatId)
    .single();
  expect(data).toEqual({ status: "closed", closed_by: woman.id });
  await womanPage.context().close();
});

test("closing kindly on day 3 shows the other person only the chosen note", async ({
  browser,
}) => {
  const id = await openChat(woman, man, { hoursOld: 50 });
  await service.from("messages").insert([
    {
      conversation_id: id,
      sender_id: woman.id,
      body: "Hello again",
      created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    },
    {
      conversation_id: id,
      sender_id: man.id,
      body: "Hi!",
      created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
  ]);
  const womanPage = await newPage(browser);
  const manPage = await newPage(browser);
  await login(womanPage, woman, `/chat/${id}`);
  await login(manPage, man, `/chat/${id}`);
  await womanPage.getByRole("button", { name: "Close kindly" }).click();
  await womanPage.getByLabel(/I do not think we are a match/).check();
  await womanPage
    .getByRole("button", { name: "Close this chat kindly" })
    .click();
  await expect(
    womanPage.getByText(
      "You closed this chat. The note you chose was shared with them.",
    ),
  ).toBeVisible();

  await manPage.reload();
  await expect(
    manPage.getByText(/I do not think we are a match, and I wish you well/),
  ).toBeVisible();
  await womanPage.context().close();
  await manPage.context().close();
});

test("the expiry job (over HTTP) ends a chat whose time ran out", async ({
  browser,
  request,
}) => {
  const id = await openChat(woman, man, { hoursOld: 73 });
  const res = await request.post(`${env.appUrl}/api/cron/expire`, {
    headers: { Authorization: `Bearer ${env.cronSecret}` },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).expired).toBeGreaterThanOrEqual(1);
  const { data } = await service
    .from("conversations")
    .select("status")
    .eq("id", id)
    .single();
  expect(data?.status).toBe("expired");

  const manPage = await newPage(browser);
  await login(manPage, man, "/chat");
  await expect(manPage.getByText(/Ended in the last/)).toBeVisible();
  await manPage.context().close();
});
