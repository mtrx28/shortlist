import { expect, test, type Browser, type Page } from "@playwright/test";
import { dropWeekStart } from "@/lib/matching/week";
import {
  createMember,
  finishProfile,
  introduce,
  removeMembers,
  service,
  signedInClient,
  type Member,
} from "../support/stack";
import {
  login,
  openChat,
  pairInOwnCity,
  watchBrowserProblems,
} from "./helpers";

// Safety: report with evidence, block from a chat and from a card, a stranger
// opening someone else's chat, the admin queue (acknowledge, evidence, action
// with suspension, overdue flag) and what a suspended person sees.

test.describe.configure({ mode: "serial" });

let woman: Member;
let man: Member;
let stranger: Member;
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
  const pair = await pairInOwnCity("Safe");
  woman = pair.woman;
  man = pair.man;
  stranger = await createMember("Safe Stranger");
  await finishProfile(stranger, {
    gender: "man",
    interestedIn: ["woman"],
    city: pair.city + "-other",
  });
  admin = await createMember("Safe Admin", { role: "admin" });
  made.push(woman, man, stranger, admin);
  chatId = await openChat(woman, man, { hoursOld: 5 });
  await service.from("messages").insert([
    {
      conversation_id: chatId,
      sender_id: woman.id,
      body: "Hello, nice to meet you",
      created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    },
    {
      conversation_id: chatId,
      sender_id: man.id,
      body: "Please send me some money for a taxi",
      created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    },
  ]);
});

test.afterAll(async () => removeMembers(made));

test("a stranger who knows the chat address gets a plain 404", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await login(page, stranger, "/home");
  // Someone else's chat and a chat that does not exist look exactly the same.
  const real = await page.goto(`/chat/${chatId}`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
  const realStatus = real?.status();
  const missing = await page.goto("/chat/6f1d3a0e-3a58-4c70-9a8e-1b2c3d4e5f60");
  await expect(page.getByText("This page could not be found")).toBeVisible();
  expect(missing?.status()).toBe(realStatus);
  await expect(page.getByText("Hello, nice to meet you")).toHaveCount(0);
  await page.context().close();
});

test("report with evidence and block in one step, with a clear confirmation", async ({
  browser,
}) => {
  const page = await newPage(browser);
  const watch = watchBrowserProblems(page);
  await login(page, woman, `/chat/${chatId}`);

  await page.getByRole("button", { name: /Safety options for/ }).click();
  await page.getByRole("button", { name: "Report", exact: true }).click();
  // Sending without a reason is refused first.
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Please pick a reason first.")).toBeVisible();
  await page.getByLabel("What happened?").selectOption("scam");
  await page
    .getByLabel(/Anything else we should know/)
    .fill("Asked me for money in the first chat.");
  await page
    .getByRole("checkbox", { name: /Include the last 20 messages/ })
    .check();
  await page.getByRole("checkbox", { name: "Also block them" }).check();
  await page.getByRole("button", { name: "Send report" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("We have your report");
  await expect(status).toContainText("within 24 hours");
  await expect(status).toContainText("You will not see each other again");

  const { data: report } = await service
    .from("reports")
    .select("id, status, reason, evidence")
    .eq("reporter_id", woman.id)
    .single();
  expect(report?.reason).toBe("scam");
  expect(report?.status).toBe("open");
  expect((report?.evidence as { body: string }[]).map((e) => e.body)).toEqual([
    "Hello, nice to meet you",
    "Please send me some money for a taxi",
  ]);
  const { data: blocks } = await service
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", woman.id);
  expect(blocks?.map((b) => b.blocked_id)).toEqual([man.id]);
  const { data: chat } = await service
    .from("conversations")
    .select("status")
    .eq("id", chatId)
    .single();
  expect(chat?.status).toBe("blocked");

  await page.getByRole("button", { name: "Close" }).click();
  expect(watch.problems).toEqual([]);
  await page.context().close();
});

test("the blocked person can no longer write or see her", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await login(page, man, `/chat/${chatId}`);
  // The chat page still opens for him (it is his chat), but without her
  // profile, and he cannot write.
  await expect(page.getByLabel(/Message to/)).toHaveCount(0);
  await expect(page.getByText(/Safe Woman/)).toHaveCount(0);
  // She still exists, but his own session cannot read her row any more.
  const client = await signedInClient(man);
  expect(
    (await client.from("profiles").select("id").eq("id", woman.id)).data,
  ).toHaveLength(0);
  await page.context().close();
});

test("block from an intro card removes the person from the shortlist", async ({
  browser,
}) => {
  const pair = await pairInOwnCity("Card");
  made.push(pair.woman, pair.man);
  await introduce(pair.woman, pair.man, dropWeekStart(new Date()));
  const page = await newPage(browser);
  await login(page, pair.man, "/shortlist");
  await expect(page.getByText("Card Woman").first()).toBeVisible();
  await page
    .getByRole("button", { name: /Safety options for Card Woman/ })
    .click();
  await page.getByRole("button", { name: "Block", exact: true }).click();
  await page.getByRole("button", { name: "Yes, block" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Done. You will not see each other again",
  );
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Card Woman")).toHaveCount(0);
  // The matching filter and the profile rule agree: neither can see the other.
  const { data } = await service
    .from("blocks")
    .select("blocker_id")
    .eq("blocked_id", pair.woman.id);
  expect(data?.map((b) => b.blocker_id)).toEqual([pair.man.id]);
  await page.context().close();
});

test("the admin queue: overdue flag, evidence only on request, acknowledge, action with suspension", async ({
  browser,
}) => {
  // A second, old report so the overdue flag shows.
  const old = await createMember("Old Reporter");
  made.push(old);
  await service.from("reports").insert({
    reporter_id: old.id,
    target_id: stranger.id,
    reason: "harassment",
    created_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
  });

  const page = await newPage(browser);
  await login(page, admin, "/admin/reports");
  await expect(
    page.getByText("Draft targets: acknowledge within 24 hours"),
  ).toBeVisible();
  await expect(
    page.getByText(/Overdue: Not acknowledged within 24 h/),
  ).toBeVisible();
  await expect(page.getByText("Safe Woman reported Safe Man")).toBeVisible();

  await page
    .getByText("Safe Woman reported Safe Man")
    .locator("..")
    .getByRole("link")
    .click();
  // The reporter's chat is not readable until the admin asks, and asking is logged.
  await expect(
    page.getByText("The reporter attached recent messages."),
  ).toBeVisible();
  await expect(page.getByText("send me some money")).toHaveCount(0);
  await page.getByRole("link", { name: "Show the attached messages" }).click();
  await expect(
    page.getByText("Please send me some money for a taxi"),
  ).toBeVisible();
  const { data: viewed } = await service
    .from("audit_log")
    .select("action")
    .eq("admin_id", admin.id)
    .eq("action", "report_evidence_viewed");
  expect(viewed?.length).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Marked as acknowledged.",
  );

  await page
    .getByLabel(/Note \(optional/)
    .fill("Confirmed by reading the attached messages.");
  await page
    .getByRole("checkbox", { name: /Also suspend the reported person/ })
    .check();
  await page.getByRole("button", { name: "Action", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Actioned, and the person is suspended.",
  );

  const { data: prof } = await service
    .from("profiles")
    .select("suspended_at")
    .eq("id", man.id)
    .single();
  expect(prof?.suspended_at).toBeTruthy();
  const { data: audit } = await service
    .from("audit_log")
    .select("action")
    .eq("admin_id", admin.id);
  expect(audit?.map((a) => a.action)).toEqual(
    expect.arrayContaining([
      "report_acknowledged",
      "user_suspended",
      "report_actioned",
    ]),
  );

  // The dashboard counts what is still open (the old report).
  await page.goto("/admin");
  await expect(page.getByText("Open reports")).toBeVisible();
  await expect(page.getByText("Past draft targets")).toBeVisible();
  await page.context().close();
});

test("a suspended person lands on a page that explains it and still offers export and delete", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await login(page, man, "/account/suspended");
  await expect(
    page.getByRole("heading", { name: "Your account is suspended" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "download your data" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "delete your account" }),
  ).toBeVisible();
  await page.goto("/shortlist");
  await expect(page).toHaveURL(/\/account\/suspended/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/account\/suspended/);
  await page.context().close();
});

test("a normal user cannot open the admin pages", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, stranger, "/home");
  for (const path of [
    "/admin",
    "/admin/reports",
    "/admin/contact",
    "/admin/drop",
  ]) {
    await page.goto(path);
    await expect(
      page.getByText("This page could not be found"),
      path,
    ).toBeVisible();
  }
  await page.context().close();
});
