import { isLocalUrl } from "@/lib/local-url";

// Safety checks for the seed script. They are plain functions so they can be
// unit tested without touching a database.

// Every demo account uses this email domain. ".test" is reserved, so it can
// never belong to a real person.
export const DEMO_EMAIL_DOMAIN = "demo.shortlist.test";

export function demoEmail(handle: string): string {
  return `${handle}@${DEMO_EMAIL_DOMAIN}`;
}

export function isDemoEmail(email: string | null | undefined): boolean {
  return (
    typeof email === "string" &&
    email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`)
  );
}

// Demo accounts are marked twice: the email domain AND app_metadata.demo.
// app_metadata can only be written with the service role (a user cannot edit
// it), so both must match before reset will delete anything.
export function isDemoUser(user: {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}): boolean {
  return isDemoEmail(user.email) && user.app_metadata?.demo === true;
}

// The script writes with the service role, so it refuses to run in a
// production environment unless the person running it says so explicitly.
export function assertSeedAllowed(
  env: { NODE_ENV?: string },
  argv: string[],
): void {
  if (env.NODE_ENV === "production" && !argv.includes("--force-demo")) {
    throw new Error(
      "Refusing to run: NODE_ENV is production. Pass --force-demo only if you really mean to create demo users here.",
    );
  }
}

// The shared password for all demo logins comes from the environment, never
// from the repo.
export function readDemoPassword(
  env: Record<string, string | undefined>,
): string {
  const password = env.DEMO_PASSWORD;
  if (!password) {
    throw new Error("DEMO_PASSWORD is not set. Add it to .env.local first.");
  }
  if (password.length < 8) {
    throw new Error("DEMO_PASSWORD must be at least 8 characters long.");
  }
  return password;
}

// Where is the seed about to write? The local stack (127.0.0.1 or localhost)
// is always fine. Any other address is a hosted project and goes through the
// existing safeguards above (production flag, --force-demo). The --local flag
// (used by `npm run seed:local`) makes the script REFUSE anything that is not
// local, so a wrong env file can never point it at the real project.
export function assertSeedTarget(
  supabaseUrl: string | undefined,
  argv: string[],
): "local" | "remote" {
  const local = isLocalUrl(supabaseUrl);
  if (argv.includes("--local") && !local) {
    throw new Error(
      "Refusing to run: --local was given but the Supabase address is not on this machine.",
    );
  }
  return local ? "local" : "remote";
}
