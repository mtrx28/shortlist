import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PHOTO_BUCKET } from "@/lib/photos";
import {
  PASSWORD,
  TINY_JPEG,
  anonClient,
  createMember,
  finishProfile,
  removeMembers,
  service,
  uniq,
  type Member,
} from "../support/stack";
import { login, openChat } from "./helpers";

// Verification review, consent withdrawal, data export, account deletion with
// re-authentication, and the contact form.

test.describe.configure({ mode: "serial" });

const made: Member[] = [];
let admin: Member;

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: "http://localhost:3100",
    acceptDownloads: true,
  });
  return context.newPage();
}

async function member(name: string) {
  const m = await createMember(name);
  await finishProfile(m, {
    gender: "woman",
    interestedIn: ["man"],
    city: uniq("Testville"),
  });
  made.push(m);
  return m;
}

test.beforeAll(async () => {
  admin = await createMember("Acct Admin", { role: "admin" });
  made.push(admin);
});
test.afterAll(async () => {
  await service
    .from("contact_messages")
    .delete()
    .like("email", "%@example.test");
  await removeMembers(made);
});

async function requestVerification(page: Page, phId: string) {
  await page.goto("/account/profile");
  await page.getByText("Verify with eLitmus (demo)").click(); // opens the section
  await page.getByLabel("pH ID", { exact: true }).fill(phId);
  await page
    .getByRole("checkbox", { name: /agree to Shortlist checking my pH ID/ })
    .check();
  await page.getByRole("button", { name: "Request verification" }).click();
  await expect(page.getByText("Request received.")).toBeVisible();
}

test("verification: request, then an admin approves one and rejects another", async ({
  browser,
}) => {
  const a = await member("Verify Alpha");
  const b = await member("Verify Beta");
  const pa = await newPage(browser);
  const pb = await newPage(browser);
  await login(pa, a, "/home");
  await requestVerification(
    pa,
    "PHALPHA" + uniq("x").slice(2, 6).toUpperCase(),
  );
  await login(pb, b, "/home");
  await requestVerification(pb, "PHBETA" + uniq("y").slice(2, 6).toUpperCase());

  const pm = await newPage(browser);
  await login(pm, admin, "/admin/verifications");
  const rowA = pm.getByRole("listitem").filter({ hasText: "Verify Alpha" });
  await rowA.getByRole("button", { name: "Approve" }).click();
  await expect(pm.getByRole("status")).toContainText(/approved/i);
  const rowB = pm.getByRole("listitem").filter({ hasText: "Verify Beta" });
  await rowB.getByRole("button", { name: "Reject" }).click();
  await expect(pm.getByRole("status")).toContainText(/rejected/i);

  const { data } = await service
    .from("profiles")
    .select("display_name, elitmus_status")
    .in("id", [a.id, b.id]);
  expect(
    Object.fromEntries(data!.map((r) => [r.display_name, r.elitmus_status])),
  ).toEqual({
    "Verify Alpha": "verified",
    "Verify Beta": "none",
  });
  const { data: audit } = await service
    .from("audit_log")
    .select("action")
    .eq("admin_id", admin.id);
  expect(audit?.map((x) => x.action)).toEqual(
    expect.arrayContaining(["verification_approved", "verification_rejected"]),
  );

  // The verified person sees the badge on their own page.
  await pa.goto("/account/profile");
  await pa.getByText("Verify with eLitmus (demo)").click();
  await expect(
    pa.getByText(/You have the "Verified via eLitmus" badge/),
  ).toBeVisible();
  for (const p of [pa, pb, pm]) await p.context().close();
});

test("withdrawing eLitmus consent removes the verification and says so first", async ({
  browser,
}) => {
  const alpha = made.find((m) => m.name === "Verify Alpha")!;
  const page = await newPage(browser);
  await login(page, alpha, "/account/privacy");
  await expect(
    page.getByText("If you withdraw: Your verification is removed"),
  ).toBeVisible();
  await expect(page.getByText(/version 2026-11-draft-1/).first()).toBeVisible();
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByRole("status")).toContainText(
    "That consent is withdrawn",
  );
  const { data } = await service
    .from("profiles")
    .select("elitmus_status")
    .eq("id", alpha.id)
    .single();
  expect(data?.elitmus_status).toBe("none");
  // Consent history is append-only: both rows are still there.
  const { data: rows } = await service
    .from("consents")
    .select("granted")
    .eq("user_id", alpha.id)
    .eq("kind", "elitmus_data_sharing")
    .order("at");
  expect(rows?.map((r) => r.granted)).toEqual([true, false]);
  // Optional marketing consent can be given and withdrawn.
  await page.getByRole("button", { name: "Give consent" }).click();
  await expect(page.getByRole("status")).toContainText("Done. Thank you.");
  await page.context().close();
});

test("data export contains only the person's own data, and is rate limited", async ({
  browser,
}) => {
  const mine = await member("Export Me");
  const other = await member("Export Other");
  const chat = await openChat(mine, other);
  await service.from("messages").insert([
    {
      conversation_id: chat,
      sender_id: mine.id,
      body: "my own export words",
      created_at: new Date(Date.now() - 2000).toISOString(),
    },
    {
      conversation_id: chat,
      sender_id: other.id,
      body: "the other persons secret words",
      created_at: new Date(Date.now() - 1000).toISOString(),
    },
  ]);
  const page = await newPage(browser);
  await login(page, mine, "/account/export");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download my data (JSON)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^shortlist-my-data-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const text = await readFile((await download.path())!, "utf8");
  const json = JSON.parse(text);
  expect(json.account.email).toBe(mine.email);
  expect(text).toContain("my own export words");
  expect(text).not.toContain("the other persons secret words");
  expect(text).not.toContain(other.id);
  expect(text).not.toContain(other.email);
  expect(text).not.toContain("Export Other");
  expect(json.profile).not.toHaveProperty("role");
  expect(json.profile).not.toHaveProperty("elitmus_ref_hash");

  // Three a day, then a clear refusal.
  for (let i = 0; i < 2; i++) {
    const res = await page.request.post("/account/export/download");
    expect(res.status()).toBe(200);
  }
  const limited = await page.request.post("/account/export/download");
  expect(limited.status()).toBe(429);
  expect((await limited.json()).message).toContain("3 times a day");

  // A cross-site POST is refused.
  const cross = await page.request.post("/account/export/download", {
    headers: { Origin: "https://evil.example" },
  });
  expect(cross.status()).toBe(403);
  await page.context().close();
});

test("deleting an account needs the password and the typed word, and removes everything", async ({
  browser,
}) => {
  const victim = await member("Delete Me");
  const friend = await member("Delete Friend");
  const chat = await openChat(victim, friend);
  await service
    .from("messages")
    .insert({ conversation_id: chat, sender_id: victim.id, body: "bye" });
  for (let i = 0; i < 2; i++) {
    await service.storage
      .from(PHOTO_BUCKET)
      .upload(`${victim.id}/p${i}.jpg`, TINY_JPEG, {
        contentType: "image/jpeg",
      });
  }
  // Someone reported the person, so the minimal safety record must stay.
  await service.from("reports").insert({
    reporter_id: friend.id,
    target_id: victim.id,
    reason: "harassment",
    details: "unique-report-details",
  });
  const recordsBefore =
    (
      await service
        .from("safety_records")
        .select("id", { count: "exact", head: true })
    ).count ?? 0;

  const page = await newPage(browser);
  await login(page, victim, "/account/delete");
  await expect(page.getByText("What is kept, and why")).toBeVisible();

  // Wrong word.
  await page.getByLabel("Your password").fill(PASSWORD);
  await page.getByLabel(/Type DELETE to confirm/).fill("delete me");
  await page
    .getByRole("button", { name: "Delete my account for good" })
    .click();
  await expect(page.getByText("Type DELETE to confirm.")).toBeVisible();
  // Wrong password.
  await page.getByLabel("Your password").fill("not-the-password-1");
  await page.getByLabel(/Type DELETE to confirm/).fill("DELETE");
  await page
    .getByRole("button", { name: "Delete my account for good" })
    .click();
  await expect(page.getByText("That password is not correct.")).toBeVisible();
  expect(
    (await service.from("profiles").select("id").eq("id", victim.id)).data,
  ).toHaveLength(1);

  // Right password and word.
  await page.getByLabel("Your password").fill(PASSWORD);
  await page.getByLabel(/Type DELETE to confirm/).fill("DELETE");
  await page
    .getByRole("button", { name: "Delete my account for good" })
    .click();
  await expect(page).toHaveURL(/\/goodbye/);
  await expect(
    page.getByRole("heading", { name: "Your account has been deleted" }),
  ).toBeVisible();

  const { data: user } = await service.auth.admin.getUserById(victim.id);
  expect(user.user).toBeNull();
  expect(
    (await service.from("profiles").select("id").eq("id", victim.id)).data,
  ).toHaveLength(0);
  expect(
    (await service.from("conversations").select("id").eq("id", chat)).data,
  ).toHaveLength(0);
  const { data: files } = await service.storage
    .from(PHOTO_BUCKET)
    .list(victim.id);
  expect(files ?? []).toHaveLength(0);
  const recordsAfter =
    (
      await service
        .from("safety_records")
        .select("id", { count: "exact", head: true })
    ).count ?? 0;
  expect(recordsAfter - recordsBefore).toBe(1);
  const { data: rep } = await service
    .from("reports")
    .select("details, target_id")
    .eq("reporter_id", friend.id)
    .single();
  expect(rep).toEqual({ details: null, target_id: null });

  // The old login no longer works and the old session is gone.
  const { error } = await anonClient().auth.signInWithPassword({
    email: victim.email,
    password: PASSWORD,
  });
  expect(error).toBeTruthy();
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);
  await page.context().close();
});

test("the contact form works, an admin sees the message, and it is rate limited", async ({
  browser,
}) => {
  const page = await newPage(browser);
  const email = `${uniq("writer")}@example.test`;
  const send = async (text: string) => {
    await page.goto("/grievance");
    await page.getByLabel("Your name").fill("Pat Writer");
    await page.getByLabel("Your email").fill(email);
    await page.getByLabel("Your message").fill(text);
    await page.getByRole("button", { name: "Send" }).click();
  };
  await send("Hello, I have a question about my data.");
  await expect(page.getByText("We have your message")).toBeVisible();
  await send("Second message about the same thing.");
  await expect(page.getByText("We have your message")).toBeVisible();
  await send("Third message about the same thing.");
  await expect(page.getByText("We have your message")).toBeVisible();
  await send("Fourth message, which should be refused.");
  await expect(
    page.getByText("We have already received several messages from you today"),
  ).toBeVisible();
  // Empty or invalid input is refused with a friendly message.
  await page.goto("/grievance");
  await page.getByLabel("Your name").fill("Pat");
  await page.getByLabel("Your email").fill("someone@example.test");
  await page.getByLabel("Your message").fill("short");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/at least a sentence/)).toBeVisible();

  const pm = await newPage(browser);
  await login(pm, admin, "/admin/contact");
  const row = pm
    .getByRole("listitem")
    .filter({ hasText: "Hello, I have a question about my data." });
  await expect(row).toContainText(email);
  await row.getByRole("button", { name: "Mark handled" }).click();
  await expect(pm.getByRole("status")).toContainText("Marked as handled.");
  await expect(
    pm.getByText("Hello, I have a question about my data."),
  ).toHaveCount(0);
  await page.context().close();
  await pm.context().close();
});

test("the policy pages are present, marked as drafts, and linked from the footer", async ({
  page,
}) => {
  await page.goto("/");
  for (const [name, heading] of [
    ["Terms", "Terms of use"],
    ["Privacy", "Privacy notice"],
    ["Community rules", "Community rules"],
    ["Safety tips", "Safety tips"],
    ["Grievance and contact", "Grievance and contact"],
  ] as const) {
    await page
      .getByRole("navigation", { name: "Policies" })
      .getByRole("link", { name })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("note")).toContainText(
      "Draft for demonstration",
    );
    await page.goto("/");
  }
  // The grievance page names an officer (a placeholder) and the draft targets.
  await page.goto("/grievance");
  await expect(
    page.getByText("Grievance Officer (name to be added)"),
  ).toBeVisible();
  await expect(page.getByText(/within 24 hours/).first()).toBeVisible();
});
