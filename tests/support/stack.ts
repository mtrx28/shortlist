import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PROMPTS } from "@/config/prompts";
import { VALUES_QUESTIONS } from "@/config/values-questions";
import { buildSignupMetadata } from "@/lib/consent";
import { loadTestEnv, type TestEnv } from "./env";

// Helpers for the tests that talk to the LOCAL Supabase stack (real GoTrue,
// PostgREST, Storage, Realtime and the Mailpit mail catcher).

export const env: TestEnv = loadTestEnv();

// Code under test (lib/account/delete.ts) reads this secret from the process
// environment, like the real server does.
process.env.SAFETY_HASH_SECRET = env.safetySecret;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// The service-role client: acts as the server. Local stack only.
export const service: SupabaseClient = createClient(
  env.url,
  env.serviceKey,
  noSession,
);

export function anonClient(): SupabaseClient {
  return createClient(env.url, env.anonKey, noSession);
}

export const PASSWORD = "Test-pass-12345";

export type Member = {
  id: string;
  email: string;
  password: string;
  name: string;
};

// A unique name per run, so tests never collide with each other or with an
// earlier run.
export const uniq = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

// Creates a login the way the app does: the signup trigger builds the profile
// and the consent rows from the metadata. The email is already confirmed.
export async function createMember(
  name: string,
  opts: { dob?: string; role?: "user" | "admin"; demo?: boolean } = {},
): Promise<Member> {
  const email = `${uniq(name.toLowerCase().replace(/[^a-z0-9]/g, ""))}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: buildSignupMetadata({
      displayName: name,
      dob: opts.dob ?? "1997-05-10",
      acceptedTerms: true,
      acceptedPrivacy: true,
    }),
    app_metadata: opts.demo ? { demo: true } : {},
  });
  if (error || !data.user)
    throw new Error(`createMember failed: ${error?.message}`);
  const member = { id: data.user.id, email, password: PASSWORD, name };
  if (opts.role === "admin") {
    await must(
      service.from("profiles").update({ role: "admin" }).eq("id", member.id),
    );
  }
  return member;
}

export type ProfileOptions = {
  gender: "woman" | "man" | "non_binary";
  interestedIn: ("woman" | "man" | "non_binary")[];
  city: string;
};

// Fills in a full, finished profile with the service role (the real onboarding
// UI is exercised separately in the browser tests). Same answers for everyone,
// so two members in the same city always match.
export async function finishProfile(member: Member, p: ProfileOptions) {
  const values: Record<string, { answer: string; dealBreaker: boolean }> = {};
  VALUES_QUESTIONS.forEach((q, i) => {
    values[q.id] = { answer: q.options[0].id, dealBreaker: i < 2 };
  });
  await must(
    service
      .from("profiles")
      .update({
        gender: p.gender,
        interested_in: p.interestedIn,
        city: p.city,
        intent: "serious",
        batch_year: 2022,
        college_tier: "tier2",
        occupation: "Engineer",
        bio_prompts: PROMPTS.slice(0, 3).map((x) => ({
          id: x.id,
          answer: "A friendly answer for the tests.",
        })),
        values_answers: values,
        interests: ["Coffee", "Reading", "Travel"],
        photos: [`${member.id}/seed.jpg`],
        verified_email: true,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq("id", member.id),
  );
}

export async function signedInClient(member: Member): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: member.email,
    password: member.password,
  });
  if (error) throw new Error(`sign in failed: ${error.message}`);
  return client;
}

// Throws a readable error when a Supabase call failed.
export async function must<T>(
  call: PromiseLike<{ data?: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(error.message);
  return data as T;
}

// A drop plus one intro each way, so two members can answer each other.
export async function introduce(a: Member, b: Member, weekStart: string) {
  const { data: existing } = await service
    .from("drops")
    .select("id")
    .eq("week_start", weekStart)
    .maybeSingle();
  let dropId = existing?.id as string | undefined;
  if (!dropId) {
    const { data } = await service
      .from("drops")
      .insert({ week_start: weekStart, stats: { test: true } })
      .select("id")
      .single();
    dropId = data!.id as string;
  }
  const { data: rows, error } = await service
    .from("intros")
    .insert([
      {
        drop_id: dropId,
        viewer_id: a.id,
        candidate_id: b.id,
        reasons: ["test"],
      },
      {
        drop_id: dropId,
        viewer_id: b.id,
        candidate_id: a.id,
        reasons: ["test"],
      },
    ])
    .select("id, viewer_id");
  if (error) throw new Error(error.message);
  return {
    dropId: dropId!,
    introOf: (viewer: Member) =>
      rows!.find((r) => r.viewer_id === viewer.id)!.id as string,
  };
}

// Deletes users made by a test (the database removes everything that hangs
// off them). Reports and events are removed first because they only "set
// null" on delete.
export async function removeMembers(members: Member[]) {
  for (const m of members) {
    await service.from("events").delete().eq("user_id", m.id);
    await service
      .from("reports")
      .delete()
      .or(`reporter_id.eq.${m.id},target_id.eq.${m.id}`);
    await service.auth.admin.deleteUser(m.id).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Mailpit: the mail catcher that comes with the local stack
// ---------------------------------------------------------------------------
type MailSummary = { ID: string; Subject: string; To: { Address: string }[] };

export async function findMail(
  to: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ id: string; subject: string; text: string; html: string }> {
  const until = Date.now() + (opts.timeoutMs ?? 20_000);
  while (Date.now() < until) {
    const res = await fetch(
      `${env.mailpitUrl}/api/v1/search?query=${encodeURIComponent("to:" + to)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as { messages?: MailSummary[] };
      const first = body.messages?.[0];
      if (first) {
        const full = await fetch(
          `${env.mailpitUrl}/api/v1/message/${first.ID}`,
        );
        const msg = (await full.json()) as {
          Subject: string;
          Text: string;
          HTML: string;
        };
        return {
          id: first.ID,
          subject: msg.Subject,
          text: msg.Text,
          html: msg.HTML,
        };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to} arrived within the time limit.`);
}

// The confirmation or reset link inside an email.
export function linkIn(mail: { text: string; html: string }): string {
  const m = /https?:\/\/[^\s"<>)]+\/auth\/v1\/verify\?[^\s"<>)]+/.exec(
    mail.text + "\n" + mail.html,
  );
  if (!m) throw new Error("No link found in the email.");
  return m[0].replace(/&amp;/g, "&");
}

// A tiny valid JPEG (1x1 pixel), for storage tests that need file bytes.
export const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64",
);

// Right after the stack starts, Realtime needs a little while before it
// delivers changes (it attaches to the database's replication stream). This
// waits until it really delivers one, using throw-away people, so the tests
// that depend on live delivery do not fail on a cold start.
export async function warmUpRealtime(timeoutMs = 90_000) {
  const a = await createMember("Warm A");
  const b = await createMember("Warm B");
  const { data: chat } = await service
    .from("conversations")
    .insert({
      user_a: a.id,
      user_b: b.id,
      opener_id: a.id,
      status: "open",
      window_ends_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  let got = false;
  const channel = service
    .channel("warm-up")
    .on(
      "postgres_changes" as never,
      { event: "INSERT", schema: "public", table: "messages" } as never,
      () => {
        got = true;
      },
    );
  await new Promise<void>((resolve) =>
    channel.subscribe((s) => s === "SUBSCRIBED" && resolve()),
  );
  const until = Date.now() + timeoutMs;
  while (!got && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    await service
      .from("messages")
      .insert({ conversation_id: chat!.id, sender_id: a.id, body: "warm up" });
  }
  await service.removeChannel(channel);
  await removeMembers([a, b]);
  if (!got)
    throw new Error("Realtime never delivered a change on the local stack.");
  // Subscriptions made by browsers a moment later still need a beat to register.
  await new Promise((r) => setTimeout(r, 1500));
}
