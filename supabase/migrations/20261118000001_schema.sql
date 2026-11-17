-- Shortlist: core schema.
--
-- Everything the app stores lives here. Row Level Security (who can see what)
-- is in the next migration so the two concerns stay easy to read separately.
--
-- Conventions:
--   * Primary keys are uuid. Users reference auth.users (Supabase's login table).
--   * Types that only have a few fixed values are Postgres enums.
--   * Rows that are history (events, orders, reports) outlive the user, so their
--     user links use "on delete set null" instead of "cascade".

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('user', 'admin');
create type public.gender as enum ('woman', 'man', 'non_binary');
create type public.intent as enum ('serious', 'open_to_see', 'friendships_first');
create type public.elitmus_status as enum ('none', 'pending', 'verified');
create type public.consent_kind as enum ('terms', 'privacy', 'marketing', 'elitmus_data_sharing');
create type public.intro_status as enum ('new', 'passed', 'interested', 'expired');
create type public.conversation_status as enum ('open', 'kept', 'closed', 'expired', 'blocked');
create type public.decision as enum ('keep', 'close');
create type public.report_reason as enum (
  'harassment', 'fake_profile', 'scam', 'inappropriate_content', 'underage', 'other'
);
create type public.report_status as enum ('open', 'ack', 'actioned', 'dismissed');

-- ---------------------------------------------------------------------------
-- Age helper
-- ---------------------------------------------------------------------------
-- Whole years between a birth date and a day. Postgres' age() counts someone
-- born on 29 Feb as turning a year older on 1 Mar in non-leap years, which is
-- the cautious reading for an 18+ rule. The TypeScript twin is lib/age.ts.
create function public.age_on(dob date, on_day date)
returns integer
language sql
immutable
as $$
  select extract(year from age(on_day, dob))::integer;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per user, created automatically at signup
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'user',
  display_name text not null check (char_length(display_name) between 1 and 50),
  dob date not null,
  gender public.gender,
  interested_in public.gender[] not null default '{}',
  city text check (char_length(city) <= 80),
  intent public.intent,
  batch_year integer check (batch_year between 2000 and 2100),
  college_tier text check (college_tier in ('tier1', 'tier2', 'tier3', 'prefer_not_to_say')),
  occupation text check (char_length(occupation) <= 100),
  bio_prompts jsonb not null default '[]',
  values_answers jsonb not null default '{}',
  interests text[] not null default '{}',
  photos text[] not null default '{}',
  verified_email boolean not null default false,
  elitmus_status public.elitmus_status not null default 'none',
  elitmus_ref_hash text,          -- hash of the pH ID, never the ID itself
  paused boolean not null default false,
  suspended_at timestamptz,       -- set by an admin; hides the profile everywhere
  plus_until timestamptz,         -- Plus entitlement, set only by the server after payment
  reply_rate_num integer not null default 0,
  reply_rate_den integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index profiles_city_intent_idx on public.profiles (city, intent)
  where deleted_at is null and suspended_at is null and paused = false;

-- 18+ rule, enforced in the database so calling the API directly cannot skip it.
-- (A CHECK constraint cannot use today's date safely, so this is a trigger.)
create function public.enforce_adult_dob()
returns trigger
language plpgsql
as $$
begin
  if public.age_on(new.dob, current_date) < 18 then
    raise exception 'You must be at least 18 years old to use Shortlist.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger profiles_adult_only
  before insert or update of dob on public.profiles
  for each row execute function public.enforce_adult_dob();

-- ---------------------------------------------------------------------------
-- consents: append-only history of what each user agreed to, and when
-- ---------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.consent_kind not null,
  policy_version text not null check (char_length(policy_version) between 1 and 40),
  granted boolean not null,
  at timestamptz not null default now()
);
create index consents_user_idx on public.consents (user_id, at desc);

-- ---------------------------------------------------------------------------
-- drops and intros: the weekly shortlist
-- ---------------------------------------------------------------------------
create table public.drops (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  run_at timestamptz not null default now(),
  stats jsonb not null default '{}'
);

create table public.intros (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.drops (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  score numeric not null default 0,
  reasons jsonb not null default '[]',
  status public.intro_status not null default 'new',
  note text check (char_length(note) <= 140),
  created_at timestamptz not null default now(),
  check (viewer_id <> candidate_id),
  unique (drop_id, viewer_id, candidate_id)
);
create index intros_viewer_idx on public.intros (viewer_id, status);
create index intros_candidate_idx on public.intros (candidate_id);

-- ---------------------------------------------------------------------------
-- conversations and messages
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  opener_id uuid not null references public.profiles (id) on delete cascade,
  origin_intro_a uuid references public.intros (id) on delete set null,
  origin_intro_b uuid references public.intros (id) on delete set null,
  status public.conversation_status not null default 'open',
  opened_at timestamptz not null default now(),
  window_ends_at timestamptz not null,
  a_decision public.decision,
  b_decision public.decision,
  closed_reason text check (char_length(closed_reason) <= 200),
  check (user_a <> user_b),
  check (opener_id in (user_a, user_b))
);
-- At most one live conversation between the same two people, whichever order.
create unique index conversations_one_live_per_pair_idx
  on public.conversations (least(user_a, user_b), greatest(user_a, user_b))
  where status in ('open', 'kept');
create index conversations_user_a_idx on public.conversations (user_a, status);
create index conversations_user_b_idx on public.conversations (user_b, status);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  flagged boolean not null default false
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- safety: blocks, reports, and a minimal record that survives account deletion
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_id uuid references public.profiles (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  reason public.report_reason not null,
  details text check (char_length(details) <= 1000),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  ack_at timestamptz,
  resolved_at timestamptz,
  admin_note text check (char_length(admin_note) <= 1000)
);
create index reports_status_idx on public.reports (status, created_at);
create index reports_target_idx on public.reports (target_id);

-- Kept after a user deletes their account: only a hash and a reason, no content.
create table public.safety_records (
  id uuid primary key default gen_random_uuid(),
  user_ref_hash text not null,
  reason text not null,
  at timestamptz not null default now()
);
create index safety_records_hash_idx on public.safety_records (user_ref_hash);

-- ---------------------------------------------------------------------------
-- orders, events, audit log
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  razorpay_order_id text not null unique,   -- unique ids make payment handling idempotent
  razorpay_payment_id text unique,
  plan text not null check (plan in ('plus_1m', 'plus_3m')),
  amount_paise integer not null check (amount_paise > 0),
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  created_at timestamptz not null default now()
);
create index orders_user_idx on public.orders (user_id);

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(name) <= 60),
  props jsonb not null default '{}',
  at timestamptz not null default now()
);
create index events_name_at_idx on public.events (name, at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target text,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Signup trigger: when Supabase creates a login, create the profile and the
-- consent rows in the same transaction.
-- ---------------------------------------------------------------------------
-- The signup form puts display_name, dob and the consent fields into the
-- user's metadata. If anything is missing or the person is under 18 this
-- raises, the whole signup is rolled back, and no account exists.
-- "security definer" lets this function write to tables the new user cannot
-- write to directly. The role is never read from metadata: everyone starts as
-- a normal user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  version text := meta ->> 'consent_version';
  birth date;
begin
  if coalesce(meta ->> 'accepted_terms', '') <> 'true'
     or coalesce(meta ->> 'accepted_privacy', '') <> 'true'
     or version is null or version = '' then
    raise exception 'Terms and privacy consent are required to sign up.'
      using errcode = 'check_violation';
  end if;

  begin
    birth := (meta ->> 'dob')::date;
  exception when others then
    raise exception 'A valid date of birth is required.' using errcode = 'check_violation';
  end;
  if birth is null then
    raise exception 'A valid date of birth is required.' using errcode = 'check_violation';
  end if;

  -- The 18+ trigger on profiles runs for this insert.
  insert into public.profiles (id, display_name, dob)
  values (new.id, coalesce(nullif(trim(meta ->> 'display_name'), ''), 'New member'), birth);

  insert into public.consents (user_id, kind, policy_version, granted)
  values (new.id, 'terms', version, true),
         (new.id, 'privacy', version, true);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.verified_email in step with Supabase's own confirmation time.
create function public.sync_email_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set verified_email = (new.email_confirmed_at is not null)
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.sync_email_verified();
