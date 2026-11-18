import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEMO_EMAIL_DOMAIN } from "@/scripts/seed/guard";
import { PUBLISHED_LOGINS } from "@/scripts/seed/demo-data";
import { anonClient, env, service } from "../support/stack";

// The demo-data script against the real local auth service and Storage (the
// part the earlier milestones could not run). Always cleans up after itself.

function seedScript(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync(
    "npx",
    ["tsx", "--env-file=.env.test.local", "scripts/seed.ts", ...args],
    {
      cwd: process.cwd(),
      shell: true,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    },
  );
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

async function demoUsers() {
  const { data } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  return data.users.filter((u) => u.email?.endsWith(`@${DEMO_EMAIL_DOMAIN}`));
}

describe("seed script on the local stack", () => {
  it("refuses a non-local address when --local is given, before touching anything", () => {
    const r = seedScript(["--local"], {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("not on this machine");
  });

  it("creates the demo members through the real auth service, and can be repeated and reset", async () => {
    try {
      const first = seedScript(["--local"]);
      expect(first.out).toContain("Seed target: local stack");
      expect(first.code, first.out).toBe(0);
      const users = await demoUsers();
      expect(users.length).toBe(20);
      expect(users.every((u) => u.app_metadata?.demo === true)).toBe(true);

      // The signup trigger gave every demo member a profile and consents.
      const { count: profiles } = await service
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in(
          "id",
          users.map((u) => u.id),
        );
      expect(profiles).toBe(20);

      // A published demo login really works (password from the env file).
      const login = PUBLISHED_LOGINS[0];
      const { error } = await anonClient().auth.signInWithPassword({
        email: `${login.handle}@${DEMO_EMAIL_DOMAIN}`,
        password: env.demoPassword,
      });
      expect(error).toBeNull();

      // Run twice: nothing is duplicated.
      const second = seedScript(["--local"]);
      expect(second.code, second.out).toBe(0);
      expect((await demoUsers()).length).toBe(20);
    } finally {
      const reset = seedScript(["--reset", "--local"]);
      expect(reset.code, reset.out).toBe(0);
    }
    expect((await demoUsers()).length).toBe(0);
    const { data: leftovers } = await service
      .from("drops")
      .select("id")
      .contains("stats", { demo: true });
    expect(leftovers).toHaveLength(0);
  });
});
