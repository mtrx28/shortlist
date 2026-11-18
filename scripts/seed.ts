import type { SupabaseClient, User } from "@supabase/supabase-js";
import { POLICY_VERSION, buildSignupMetadata } from "@/lib/consent";
import { hashPhId } from "@/lib/elitmus";
import { PHOTO_BUCKET } from "@/lib/photos";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeAvatarPng } from "./seed/avatar";
import {
  PUBLISHED_LOGINS,
  buildDemoProfiles,
  buildScenario,
  uuidFromKey,
  type DemoProfile,
} from "./seed/demo-data";
import {
  DEMO_EMAIL_DOMAIN,
  assertSeedAllowed,
  isDemoUser,
  readDemoPassword,
} from "./seed/guard";

// Creates (or refreshes) the demo users and their data.
//   npm run seed          create or refresh the demo data
//   npm run seed:reset    remove ONLY the demo users and their data
//
// It uses the service role, so it must only run where you mean it to. It
// never prints keys or the demo password. Safe to run repeatedly.

const PHOTOS_PER_USER = 2;

// Throws a readable error when a Supabase call fails.
function must<T>(label: string, result: { data: T; error: unknown }): T {
  if (result.error) {
    const message =
      (result.error as { message?: string }).message ?? "unknown error";
    throw new Error(`${label} failed: ${message}`);
  }
  return result.data;
}

async function listAllUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`Listing users failed: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function removeDemoPhotos(admin: SupabaseClient, userId: string) {
  const { data } = await admin.storage
    .from(PHOTO_BUCKET)
    .list(userId, { limit: 100 });
  const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
  if (paths.length > 0) await admin.storage.from(PHOTO_BUCKET).remove(paths);
}

// ---------------------------------------------------------------------------
// reset: delete demo users and everything that belongs to them
// ---------------------------------------------------------------------------
async function reset(admin: SupabaseClient) {
  const demoUsers = (await listAllUsers(admin)).filter(isDemoUser);
  const ids = demoUsers.map((u) => u.id);
  if (ids.length === 0) {
    console.log("No demo users found. Nothing to remove.");
    return;
  }

  // These tables only "set null" when a user goes away, so remove the demo
  // rows first. Everything else (profile, intros, conversations, messages,
  // consents, blocks) is removed by the database when the user is deleted.
  must("events", await admin.from("events").delete().in("user_id", ids));
  must("orders", await admin.from("orders").delete().in("user_id", ids));
  must(
    "reports",
    await admin
      .from("reports")
      .delete()
      .or(`reporter_id.in.(${ids.join(",")}),target_id.in.(${ids.join(",")})`),
  );
  must(
    "drops",
    await admin.from("drops").delete().contains("stats", { demo: true }),
  );

  for (const user of demoUsers) {
    await removeDemoPhotos(admin, user.id);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Deleting a demo user failed: ${error.message}`);
  }
  console.log(`Removed ${ids.length} demo users and their data.`);
  console.log(
    "Admin audit log rows are kept on purpose (the log is append-only).",
  );
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------
async function upsertAuthUser(
  admin: SupabaseClient,
  existing: Map<string, User>,
  p: DemoProfile,
  password: string,
): Promise<string> {
  const metadata = buildSignupMetadata({
    displayName: p.displayName,
    dob: p.dob,
    acceptedTerms: true,
    acceptedPrivacy: true,
  });
  const found = existing.get(p.email);
  if (found) {
    // Never touch a real account that happens to share an email.
    if (!isDemoUser(found)) {
      throw new Error(`${p.email} exists but is not a demo account. Stopping.`);
    }
    const { error } = await admin.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: { demo: true },
    });
    if (error) throw new Error(`Updating ${p.handle} failed: ${error.message}`);
    return found.id;
  }
  // The signup trigger in the database creates the profile and the two
  // consent rows from this metadata, just like a real signup.
  const { data, error } = await admin.auth.admin.createUser({
    email: p.email,
    password,
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: { demo: true },
  });
  if (error || !data.user) {
    throw new Error(`Creating ${p.handle} failed: ${error?.message}`);
  }
  return data.user.id;
}

async function uploadAvatars(
  admin: SupabaseClient,
  p: DemoProfile,
  userId: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < PHOTOS_PER_USER; i++) {
    // A fixed name per user and slot, so re-running replaces the same file.
    const path = `${userId}/${uuidFromKey(`photo:${p.handle}:${i}`)}.png`;
    const { error } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(path, makeAvatarPng(`${p.handle}:${i}`), {
        contentType: "image/png",
        upsert: true,
      });
    if (error) throw new Error(`Uploading a photo failed: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

async function seed(admin: SupabaseClient) {
  const password = readDemoPassword(process.env);
  // Demo IDs are fake, so a fixed fallback secret is fine when none is set.
  const hashSecret = process.env.ELITMUS_HASH_SECRET || "demo-only-secret";
  const profiles = buildDemoProfiles();

  const existing = new Map(
    (await listAllUsers(admin)).map((u) => [u.email ?? "", u]),
  );

  const idOf: Record<string, string> = {};
  for (const p of profiles) {
    const userId = await upsertAuthUser(admin, existing, p, password);
    idOf[p.handle] = userId;
    const photos = await uploadAvatars(admin, p, userId);

    // Written with the service role, the only way to set role, verified_email
    // and elitmus_status (users have no update grant for them).
    must(
      `profile ${p.handle}`,
      await admin
        .from("profiles")
        .update({
          role: p.role,
          display_name: p.displayName,
          gender: p.gender,
          interested_in: p.interestedIn,
          city: p.city,
          intent: p.intent,
          batch_year: p.batchYear,
          college_tier: p.collegeTier,
          occupation: p.occupation,
          bio_prompts: p.bioPrompts,
          values_answers: p.valuesAnswers,
          interests: p.interests,
          photos,
          verified_email: true,
          elitmus_status: p.elitmusStatus,
          elitmus_ref_hash: p.phId ? hashPhId(p.phId, hashSecret) : null,
          paused: p.paused,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq("id", userId),
    );

    // Consent to share eLitmus data, once, for people who asked for it.
    if (p.elitmusStatus !== "none") {
      const rows = must(
        "consents",
        await admin
          .from("consents")
          .select("id")
          .eq("user_id", userId)
          .eq("kind", "elitmus_data_sharing"),
      );
      if ((rows ?? []).length === 0) {
        must(
          "consent insert",
          await admin.from("consents").insert({
            user_id: userId,
            kind: "elitmus_data_sharing",
            policy_version: POLICY_VERSION,
            granted: true,
          }),
        );
      }
    }
  }

  // Scenario rows are rebuilt from scratch each run, so the clocks (such as
  // "6 hours left in the window") are fresh after every seed.
  const ids = Object.values(idOf);
  const scenario = buildScenario(profiles, idOf, new Date());

  must(
    "old conversations",
    await admin.from("conversations").delete().in("user_a", ids),
  );
  must(
    "old drops",
    await admin.from("drops").delete().contains("stats", { demo: true }),
  );
  // A drop made by "Run drop now" for one of the two demo weeks would clash
  // with the demo drop (one drop per week), so it is removed too. This script
  // only ever runs against a demo database.
  must(
    "drops of the demo weeks",
    await admin
      .from("drops")
      .delete()
      .in(
        "week_start",
        scenario.drops.map((d) => d.week_start),
      ),
  );
  must("old events", await admin.from("events").delete().in("user_id", ids));
  must(
    "old reports",
    await admin.from("reports").delete().in("reporter_id", ids),
  );

  must("drops", await admin.from("drops").insert(scenario.drops));
  must("intros", await admin.from("intros").insert(scenario.intros));
  must(
    "conversations",
    await admin.from("conversations").insert(scenario.conversations),
  );
  must("messages", await admin.from("messages").insert(scenario.messages));
  must("reports", await admin.from("reports").insert(scenario.reports));
  must("events", await admin.from("events").insert(scenario.events));

  console.log(`Seeded ${profiles.length} demo users (@${DEMO_EMAIL_DOMAIN}).`);
  console.log(
    `${scenario.intros.length} intros, ${scenario.conversations.length} conversations, ${scenario.messages.length} messages.`,
  );
  console.log("\nPublished logins (password is your DEMO_PASSWORD):");
  for (const login of PUBLISHED_LOGINS) {
    console.log(`  ${login.handle}@${DEMO_EMAIL_DOMAIN}  ${login.role}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  assertSeedAllowed(process.env, argv);

  const admin = createAdminClient();
  if (!admin) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.",
    );
  }

  if (argv.includes("--reset")) await reset(admin);
  else await seed(admin);
}

main().catch((error: unknown) => {
  // Print only the message: never the environment or the client object.
  console.error(error instanceof Error ? error.message : "Seed failed.");
  process.exit(1);
});
