import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEVER_PAYWALLED } from "@/config/plans";

// The "never paywalled" promise, as a test. Safety, verification, account
// tools, being seen, the core weekly intros and messaging are free for
// everybody (see config/plans.ts and the monetization decision). If someone
// later makes one of them depend on Plus, the code that implements it would
// start to mention Plus, and this test fails.
//
// It looks at the files listed for each promise and fails when they use any of
// the things that read the entitlement: lib/plus, isPlus, entitlements,
// plus_until, the Plus perk constants or the plans config.

const FORBIDDEN =
  /lib\/plus|isPlus|entitlements|plus_until|PLUS_PERKS|FREE_LIMITS|config\/plans|chatCapPlus|introsPlus|isPlusMember/;

function filesUnder(path: string): string[] {
  const full = join(process.cwd(), path);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesUnder(join(path, e.name))
      : /\.(ts|tsx)$/.test(e.name)
        ? [join(full, e.name)]
        : [],
  );
}

describe("never paywalled", () => {
  it("lists at least the promises from the decision log", () => {
    const keys = NEVER_PAYWALLED.map((n) => n.key);
    for (const k of [
      "report_and_block",
      "verification",
      "account_tools",
      "being_seen",
      "weekly_intros",
      "messaging",
    ]) {
      expect(keys).toContain(k);
    }
  });

  for (const promise of NEVER_PAYWALLED) {
    it(`${promise.label}: the code behind it does not look at Plus`, () => {
      const files = promise.paths.flatMap((p) => filesUnder(p));
      // A typo in a path would silently test nothing.
      expect(files.length, `no files found for ${promise.key}`).toBeGreaterThan(
        0,
      );
      const offenders = files.filter((f) =>
        FORBIDDEN.test(readFileSync(f, "utf8")),
      );
      expect(offenders.map((f) => f.replace(process.cwd(), ""))).toEqual([]);
    });
  }

  it("the free tier still gets the full core: reports, blocks and exports have no entitlement check in the database either", () => {
    // The migrations that define report, block, export and delete functions
    // must not mention plus_until (the entitlement column).
    const dir = join(process.cwd(), "supabase/migrations");
    const safety = readFileSync(
      join(dir, "20261118000008_safety_privacy.sql"),
      "utf8",
    );
    const blocks = readFileSync(
      join(dir, "20261118000010_blocks_through_function.sql"),
      "utf8",
    );
    // The export lists the member's own plus_until as part of THEIR data; that
    // is the only allowed mention.
    const mentions = safety.split("\n").filter((l) => /plus_until/.test(l));
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatch(/'plus_until', me\.plus_until/);
    expect(blocks).not.toMatch(/plus_until/);
  });
});
