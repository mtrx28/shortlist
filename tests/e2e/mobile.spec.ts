import { expect, test } from "@playwright/test";
import { dropWeekStart } from "@/lib/matching/week";
import {
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
  watchBrowserProblems,
} from "./helpers";

// The main flows on a phone-sized screen (Pixel 5, Chromium): nothing
// overflows sideways, the controls can be reached and used, and the chat sends.

const made: Member[] = [];
test.afterAll(async () => removeMembers(made));

async function noSidewaysScroll(
  page: import("@playwright/test").Page,
  label: string,
) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(
    overflow,
    `${label} scrolls sideways by ${overflow}px`,
  ).toBeLessThanOrEqual(1);
}

test("shortlist, safety menu, chat and menus work on a phone", async ({
  page,
}) => {
  const watch = watchBrowserProblems(page);
  const { woman, man } = await pairInOwnCity("Mob");
  made.push(woman, man);
  await introduce(woman, man, dropWeekStart(new Date()));

  await login(page, man, "/home");
  await noSidewaysScroll(page, "/home");
  await page.goto("/shortlist");
  await expect(page.getByText("Mob Woman").first()).toBeVisible();
  await noSidewaysScroll(page, "/shortlist");
  await page
    .getByRole("button", { name: /Safety options for Mob Woman/ })
    .click();
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await noSidewaysScroll(page, "/shortlist with the report form");
  await expectNoSeriousA11yIssues(page, "mobile /shortlist report form");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();

  // A chat, written in from the phone.
  const chat = await openChat(woman, man);
  await service.from("messages").insert({
    conversation_id: chat,
    sender_id: woman.id,
    body: "Hi from the other side",
  });
  await page.goto(`/chat/${chat}`);
  await expect(page.getByRole("log")).toContainText("Hi from the other side");
  await page.getByLabel(/Message to/).fill("Hello from my phone");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Hello from my phone");
  await noSidewaysScroll(page, "/chat");
  await expectNoSeriousA11yIssues(page, "mobile /chat");

  // The Plus page (price table, plan buttons, fine print) fits too.
  await page.goto("/plus");
  await expect(page.getByTestId("mode-ribbon")).toBeVisible();
  await noSidewaysScroll(page, "/plus");
  await expectNoSeriousA11yIssues(page, "mobile /plus");
  await page.getByRole("button", { name: /Get Plus for 1 month/ }).click();
  await page.waitForURL(/\/plus\/checkout\//);
  await noSidewaysScroll(page, "/plus/checkout");

  // The policy pages and footer fit too.
  for (const path of ["/privacy", "/grievance", "/account/delete", "/terms"]) {
    await page.goto(path);
    await noSidewaysScroll(page, path);
  }
  expect(watch.problems).toEqual([]);
});
