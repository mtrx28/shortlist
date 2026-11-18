import { expect, test } from "@playwright/test";
import { PHOTO_BUCKET } from "@/lib/photos";
import {
  findMail,
  linkIn,
  PASSWORD,
  removeMembers,
  service,
  uniq,
} from "../support/stack";
import { bodyText, makeJpegWithExif, watchBrowserProblems } from "./helpers";

// A brand-new person: sign up in the browser, confirm the email from the mail
// catcher, finish onboarding with a photo, log out and back in.

test("sign up, confirm by email, finish onboarding, photo has no EXIF", async ({
  page,
}) => {
  const watch = watchBrowserProblems(page);
  const first = uniq("Newbie").replace("-", "");
  const email = `${first.toLowerCase()}@example.test`;

  await page.goto("/signup");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Date of birth").fill("1996-04-12");
  await page.getByRole("checkbox", { name: /agree to the Terms/ }).check();
  await page.getByRole("checkbox", { name: /read the Privacy Notice/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/check-email/);

  // Logging in before confirming is refused with a clear message.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Please confirm your email first")).toBeVisible();

  // The confirmation email arrives in the mail catcher; open its link.
  const mail = await findMail(email);
  await page.goto(linkIn(mail));
  await expect(page).toHaveURL(/\/onboarding/); // signed in, profile not finished yet

  const { data: profile } = await service
    .from("profiles")
    .select("id, verified_email")
    .eq("display_name", first)
    .single();
  expect(profile?.verified_email).toBe(true);
  const userId = profile!.id as string;

  try {
    // Step 1: about you
    await page
      .getByRole("group", { name: "I am a" })
      .getByText("Woman")
      .click();
    await page
      .getByRole("group", { name: "I would like to meet" })
      .getByText("Man", { exact: true })
      .click();
    await page.getByLabel("City", { exact: true }).selectOption("Pune");
    await page
      .getByRole("group", { name: "What are you looking for?" })
      .getByText("A serious relationship")
      .click();
    await page.getByLabel("pH batch year").selectOption("2022");
    await page.getByLabel("What do you do?").fill("Software engineer");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 2: eight questions and two deal-breakers
    await expect(
      page.getByRole("heading", { name: "What matters to you" }),
    ).toBeVisible();
    const groups = page
      .getByRole("group")
      .filter({ has: page.locator('input[type="radio"]') });
    const count = await groups.count();
    expect(count).toBe(8);
    for (let i = 0; i < count; i++) {
      await groups.nth(i).locator("label").first().click();
    }
    const dealBreakers = page.getByRole("checkbox", {
      name: "Deal-breaker for me",
    });
    await dealBreakers.nth(0).check();
    await dealBreakers.nth(1).check();
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 3: three prompts
    await expect(
      page.getByRole("heading", { name: "In your own words" }),
    ).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await page
        .locator(`select[name="promptId_${i}"]`)
        .selectOption({ index: i + 1 });
      await page
        .locator(`textarea[name="answer_${i}"]`)
        .fill(`This is my honest answer number ${i + 1}.`);
    }
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 4: interests
    await expect(
      page.getByRole("heading", { name: "Your interests" }),
    ).toBeVisible();
    for (const i of ["Coffee", "Reading", "Travel"]) {
      await page.getByRole("group").getByText(i, { exact: true }).click();
    }
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Step 5: a photo with fake location data inside
    await expect(
      page.getByRole("heading", { name: "Your photos" }),
    ).toBeVisible();
    const marker = "GPSLatitude=12.9716N-SECRET-MARKER";
    const jpeg = await makeJpegWithExif(page, marker);
    await page.locator("#photo-input").setInputFiles({
      name: "holiday.jpg",
      mimeType: "image/jpeg",
      buffer: jpeg,
    });
    try {
      await expect(page.getByAltText("Your profile photo")).toBeVisible({
        timeout: 30_000,
      });
    } catch (e) {
      throw new Error(`Photo never appeared. Browser said: ${watch.problems.join(" | ")}
${(e as Error).message}`);
    }

    // The file that reached Storage: right type, no EXIF, no marker.
    const { data: files } = await service.storage
      .from(PHOTO_BUCKET)
      .list(userId);
    expect(files).toHaveLength(1);
    const { data: blob } = await service.storage
      .from(PHOTO_BUCKET)
      .download(`${userId}/${files![0].name}`);
    const bytes = Buffer.from(await blob!.arrayBuffer());
    expect(blob!.type).toBe("image/webp");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect(bytes.includes(Buffer.from(marker))).toBe(false);
    expect(bytes.includes(Buffer.from("GPS"))).toBe(false);

    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page).toHaveURL(/\/home/);
    await expect(
      page.getByRole("heading", { name: `Hello, ${first}` }),
    ).toBeVisible();

    // Log out and back in through the form.
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(
      page.getByText("Email or password is incorrect."),
    ).toBeVisible();
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/home/);
    expect(await bodyText(page)).toContain("Your shortlist");
    expect(watch.problems).toEqual([]);
  } finally {
    const { data } = await service.storage.from(PHOTO_BUCKET).list(userId);
    if (data?.length)
      await service.storage
        .from(PHOTO_BUCKET)
        .remove(data.map((f) => `${userId}/${f.name}`));
    await removeMembers([
      { id: userId, email, password: PASSWORD, name: first },
    ]);
  }
});
