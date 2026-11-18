import { test } from "@playwright/test";
import { dropWeekStart } from "@/lib/matching/week";
import {
  createMember,
  introduce,
  removeMembers,
  service,
  type Member,
} from "../support/stack";
import {
  expectNoSeriousA11yIssues,
  login,
  openChat,
  pairInOwnCity,
} from "./helpers";

// Automated accessibility check (axe-core) on the key pages. It fails on
// serious or critical problems; minor ones are not enforced. This is a good
// safety net, not a replacement for trying the app with a screen reader.

const made: Member[] = [];
test.afterAll(async () => removeMembers(made));

test("public pages have no serious accessibility problems", async ({
  page,
}) => {
  for (const path of [
    "/",
    "/demo",
    "/does-not-exist",
    "/login",
    "/signup",
    "/forgot-password",
    "/terms",
    "/privacy",
    "/community-rules",
    "/safety",
    "/grievance",
  ]) {
    await page.goto(path);
    await expectNoSeriousA11yIssues(page, path);
  }
});

test("signed-in pages have no serious accessibility problems", async ({
  page,
}) => {
  const { woman, man } = await pairInOwnCity("Axe");
  const admin = await createMember("Axe Admin", { role: "admin" });
  made.push(woman, man, admin);
  await introduce(woman, man, dropWeekStart(new Date()));
  const chat = await openChat(woman, man);
  await service.from("messages").insert({
    conversation_id: chat,
    sender_id: woman.id,
    body: "Hello there",
  });

  await login(page, man, "/home");
  await expectNoSeriousA11yIssues(page, "/home");
  for (const path of [
    "/shortlist",
    "/plus",
    "/chat",
    `/chat/${chat}`,
    "/account/profile",
    "/account/privacy",
    "/account/export",
    "/account/delete",
  ]) {
    await page.goto(path);
    await expectNoSeriousA11yIssues(page, path);
  }
  // The safety menu open on a card and on a chat.
  await page.goto("/shortlist");
  await page.getByRole("button", { name: /Safety options for/ }).click();
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expectNoSeriousA11yIssues(page, "/shortlist with the report form open");
  await page.goto(`/chat/${chat}`);
  await page.getByRole("button", { name: /Safety options for/ }).click();
  await expectNoSeriousA11yIssues(page, "/chat with the safety menu open");

  await page.context().clearCookies();
  await login(page, admin, "/admin");
  for (const path of [
    "/admin",
    "/admin/reports",
    "/admin/contact",
    "/admin/verifications",
    "/admin/drop",
    "/admin/orders",
  ]) {
    await page.goto(path);
    await expectNoSeriousA11yIssues(page, path);
  }
});
