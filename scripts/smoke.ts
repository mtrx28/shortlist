import {
  checkHealthBody,
  checkSecurityHeaders,
  normaliseBaseUrl,
  type Problem,
} from "./smoke/checks";

// A quick check that a deployed copy of Shortlist is alive and set up safely.
//
//   npm run smoke -- https://your-app.vercel.app
//
// It only reads public pages (and sends requests that must be refused). It
// never writes data. Optional extras through environment variables:
//   CRON_SECRET                      also checks that the keep-alive job works
//                                    (one tiny database query).
//   SMOKE_EMAIL and SMOKE_PASSWORD   also logs in through the real form in a
//                                    headless browser (needs `npx playwright
//                                    install chromium` once) and checks the
//                                    page after login.
// The exit code is 0 when everything passed, 1 otherwise.

const base = normaliseBaseUrl(process.argv[2] ?? process.env.SMOKE_URL);
if (!base) {
  console.error(
    "Usage: npm run smoke -- <url>   (for example https://your-app.vercel.app)",
  );
  process.exit(2);
}
const isHttps = base.startsWith("https://");

let failed = 0;
function report(name: string, problems: Problem[]) {
  if (problems.length === 0) {
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}`);
    for (const p of problems) console.log(`        - ${p}`);
  }
}

async function get(path: string, init?: RequestInit) {
  return fetch(base + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
}

async function check(name: string, run: () => Promise<Problem[]>) {
  try {
    report(name, await run());
  } catch (error) {
    report(name, [
      `request failed: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

async function pageContains(path: string, text: string): Promise<Problem[]> {
  const res = await get(path);
  if (res.status !== 200) return [`${path} answered ${res.status}, not 200`];
  const body = await res.text();
  return body.includes(text) ? [] : [`${path} does not contain "${text}"`];
}

async function loginCheck(email: string, password: string): Promise<Problem[]> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const problems: Problem[] = [];
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (/Content Security Policy|violates the following/i.test(m.text())) {
        problems.push(`CSP refusal in the browser: ${m.text().slice(0, 200)}`);
      }
    });
    await page.goto(`${base}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    try {
      await page.waitForURL(
        (url) =>
          ["/home", "/onboarding", "/admin"].some((p) =>
            url.pathname.startsWith(p),
          ),
        { timeout: 30_000 },
      );
    } catch {
      problems.push(`login did not leave /login (now at ${page.url()})`);
    }
  } finally {
    await browser.close();
  }
  return problems;
}

async function main() {
  console.log(`Smoke test for ${base}\n`);

  await check("GET /api/health answers ok", async () => {
    const res = await get("/api/health");
    if (res.status !== 200) return [`answered ${res.status}, not 200`];
    return checkHealthBody(await res.json());
  });

  await check("GET / shows the landing page", () =>
    pageContains("/", "Three introductions a week"),
  );
  await check("GET /demo shows the evaluator guide", () =>
    pageContains("/demo", "Evaluator guide"),
  );
  await check("GET /terms", () => pageContains("/terms", "Terms of use"));
  await check("GET /privacy", () => pageContains("/privacy", "Privacy notice"));
  await check("GET /manifest.webmanifest names the app", () =>
    pageContains("/manifest.webmanifest", '"Shortlist"'),
  );

  await check(
    "a signed-out visitor to /shortlist is sent to login",
    async () => {
      const res = await get("/shortlist");
      const where = res.headers.get("location") ?? "";
      return res.status >= 300 && res.status < 400 && where.includes("/login")
        ? []
        : [`/shortlist answered ${res.status} (location: ${where || "none"})`];
    },
  );

  for (const path of [
    "/api/cron/drop",
    "/api/cron/expire",
    "/api/cron/keepalive",
  ]) {
    await check(`POST ${path} without the secret is refused`, async () => {
      const res = await get(path, { method: "POST" });
      return res.status === 401 ? [] : [`answered ${res.status}, not 401`];
    });
    await check(`POST ${path} with a wrong secret is refused`, async () => {
      const res = await get(path, {
        method: "POST",
        headers: { Authorization: "Bearer not-the-secret" },
      });
      return res.status === 401 ? [] : [`answered ${res.status}, not 401`];
    });
  }

  await check("security headers on /", async () => {
    const res = await get("/");
    return checkSecurityHeaders(res.headers, isHttps);
  });

  const cron = process.env.CRON_SECRET;
  if (cron) {
    await check("keep-alive job works (uses CRON_SECRET)", async () => {
      const res = await get("/api/cron/keepalive", {
        method: "POST",
        headers: { Authorization: `Bearer ${cron}` },
      });
      return res.status === 200
        ? []
        : [
            `answered ${res.status}: the secret may differ from the app's CRON_SECRET, or the database is unreachable`,
          ];
    });
  } else {
    console.log("SKIP  keep-alive with the secret (CRON_SECRET not set)");
  }

  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (email && password) {
    await check("login through the real form (SMOKE_EMAIL)", () =>
      loginCheck(email, password),
    );
  } else {
    console.log("SKIP  login (SMOKE_EMAIL and SMOKE_PASSWORD not set)");
  }

  console.log(
    failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
