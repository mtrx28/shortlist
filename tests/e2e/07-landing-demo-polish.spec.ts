import { expect, test } from "@playwright/test";
import {
  createMember,
  finishProfile,
  removeMembers,
  type Member,
} from "../support/stack";
import { login, watchBrowserProblems } from "./helpers";

// The public front door (landing page, evaluator guide), the polish items
// (skip link, 404, manifest, fonts) and the admin metrics cards.

const made: Member[] = [];
test.afterAll(async () => removeMembers(made));

test("the landing page explains the product and has clear ways in", async ({
  page,
}) => {
  const watch = watchBrowserProblems(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Three introductions a week/ }),
  ).toBeVisible();
  for (const heading of [
    "The problem with swipe apps",
    "The rules, in plain words",
    "Trust and safety",
    "Plus is for convenience, never for safety",
    "What is real, what is simulated, what is next",
    "Why this belongs at eLitmus",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: heading }),
    ).toBeVisible();
  }
  // The numbers on the page are the real rules.
  const text = await page.locator("main").innerText();
  expect(text).toContain("3 introductions a week");
  expect(text).toContain("72 hours to reply");
  expect(text).toContain("Women write first");
  expect(text).toMatch(/never shows one|never asks for your pH score/);

  await expect(
    page.getByRole("link", { name: "Create account" }).first(),
  ).toHaveAttribute("href", "/signup");
  await expect(
    page.getByRole("link", { name: /Try the demo/ }),
  ).toHaveAttribute("href", "/demo");
  await expect(
    page.getByRole("link", { name: "See what Plus includes" }),
  ).toHaveAttribute("href", "/plus");

  // Real metadata and link preview tags.
  await expect(page).toHaveTitle(/Shortlist/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /introductions/,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  expect(watch.problems).toEqual([]);
});

test("the evaluator guide works signed out and never prints the seed password", async ({
  page,
}) => {
  const watch = watchBrowserProblems(page);
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/demo$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Evaluator guide" }),
  ).toBeVisible();
  for (const handle of ["priya", "arjun", "ananya", "neha", "admin"]) {
    await expect(page.getByText(`${handle}@demo.shortlist.test`)).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: /What is simulated/ }),
  ).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).toContain("pH");
  expect(text).toContain("Payments");
  // Without DEMO_PASSWORD_PUBLIC the page points elsewhere for the password.
  expect(text).toMatch(/submission form and in the README/);
  expect(watch.problems).toEqual([]);
});

test("a member who is signed in goes from / to /home", async ({ page }) => {
  const member = await createMember("Landing Member");
  made.push(member);
  await finishProfile(member, {
    gender: "woman",
    interestedIn: ["man"],
    city: "Testville-landing",
  });
  await login(page, member, "/home");
  await page.goto("/");
  await expect(page).toHaveURL(/\/home/);
});

test("the skip link, the 404 page and the manifest", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "We could not find that page" }),
  ).toBeVisible();

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(body.name).toBe("Shortlist");
  expect(body.display).toBe("standalone");
  const sizes = body.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of body.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  const apple = await request.get("/apple-touch-icon.png");
  expect(apple.status()).toBe(200);
});

test("the page really uses Geist, not a fallback serif", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const family = getComputedStyle(document.body).fontFamily;
    const loaded = [...document.fonts].some(
      (f) => /Geist/i.test(f.family) && f.status === "loaded",
    );
    return { family, loaded };
  });
  expect(result.family).toMatch(/Geist/i);
  expect(result.loaded).toBe(true);
});

test("the admin dashboard shows the metrics cards", async ({ page }) => {
  const admin = await createMember("Metrics Admin", { role: "admin" });
  made.push(admin);
  await login(page, admin, "/admin");
  const cards = page.getByTestId("metrics-cards");
  await expect(cards).toBeVisible();
  for (const label of [
    "Members",
    "Verified via eLitmus",
    "Active chats",
    "Intros delivered",
    "Reply rate within 72h",
    "Keep vs close",
    "Plus members",
    "Revenue (test mode)",
  ]) {
    await expect(cards.getByText(label, { exact: true })).toBeVisible();
  }
});
