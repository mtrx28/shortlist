import { defineConfig, devices } from "@playwright/test";

// Browser tests (npm run test:e2e). They drive the real app, built against the
// LOCAL Supabase stack, in a real Chromium. The app is started here when it is
// not already running (npm run test:all starts it itself and Playwright just
// reuses it). Everything runs one test at a time because the tests share one
// database and some of them are steps of one long story.

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      // A phone-sized screen (Pixel 5, still Chromium) for the main flows and
      // the accessibility checks, so both layouts are checked by axe.
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      testMatch: /(mobile|05-accessibility)\.spec\.ts/,
    },
  ],
  webServer: {
    // Needs a build first: npx tsx scripts/test/serve.ts build
    command: "npx tsx scripts/test/serve.ts start",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
  },
});
