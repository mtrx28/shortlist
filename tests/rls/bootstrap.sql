-- Stand-ins for the parts of a Supabase project that the migrations rely on but
-- do not create: the roles, the auth.users table and auth.uid().
-- Real Supabase already has these. This file is only used by the local test
-- database in tests/rls and is never applied to a real project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}',
  email_confirmed_at timestamptz
);

-- Supabase reads the user id from the request's JWT; the tests set it with
-- set_config('request.jwt.claim.sub', ...) to act as a given user.
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase gives its roles broad default rights on new tables; the RLS
-- migration then narrows them. Mimic that so the test exercises the real thing.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
