-- Shortlist: onboarding, photos and eLitmus verification.
--
-- Adds to what the first two migrations built (those are already applied, so
-- this is a separate file):
--   1. profiles.onboarding_completed_at, set only by complete_onboarding().
--   2. Size and ownership limits on the profile arrays and JSON.
--   3. One pH ID hash can be linked to only one account.
--   4. A private storage bucket for photos, with policies.
-- Every new column or function states its grants here, because the earlier
-- migration revoked default rights on tables that already existed.

-- ---------------------------------------------------------------------------
-- 1. Onboarding flag
-- ---------------------------------------------------------------------------
alter table public.profiles add column onboarding_completed_at timestamptz;

-- Users can read it (the app uses it to redirect) but not write it: it is not
-- in the update grant. The only way to set it is complete_onboarding() below.
grant select (onboarding_completed_at) on public.profiles to authenticated;

-- Marks onboarding as done for the caller, but only if the profile is really
-- complete. It is "security definer" so it can write the column the user has
-- no grant for. It returns true when the profile is complete.
-- The counts below (8 answers, 3 prompts, 3 interests, 1 photo) match
-- config/values-questions.ts, config/prompts.ts and config/profile-options.ts.
create function public.complete_onboarding()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  update public.profiles p
     set onboarding_completed_at = coalesce(p.onboarding_completed_at, now())
   where p.id = auth.uid()
     and p.gender is not null
     and cardinality(p.interested_in) >= 1
     and p.city is not null
     and p.intent is not null
     and p.batch_year is not null
     and p.occupation is not null
     and (select count(*) from jsonb_object_keys(p.values_answers)) >= 8
     and jsonb_array_length(p.bio_prompts) >= 3
     and cardinality(p.interests) >= 3
     and cardinality(p.photos) >= 1
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

revoke execute on function public.complete_onboarding() from public, anon;
grant execute on function public.complete_onboarding() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Limits on what a user can write into their own profile
-- ---------------------------------------------------------------------------
-- The app validates everything with Zod first. These are a safety net for
-- someone calling the API directly: they cap sizes and stop a profile from
-- pointing at another person's photo.

-- True when every path in the list starts with the owner's id (their folder).
create function public.photos_belong_to(owner uuid, paths text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(p like owner::text || '/%'), true) from unnest(paths) as p;
$$;

alter table public.profiles
  add constraint profiles_photos_valid
    check (cardinality(photos) <= 4 and public.photos_belong_to(id, photos)),
  add constraint profiles_interests_size
    check (cardinality(interests) <= 10),
  add constraint profiles_interested_in_size
    check (cardinality(interested_in) <= 3),
  add constraint profiles_bio_prompts_shape
    check (jsonb_typeof(bio_prompts) = 'array' and octet_length(bio_prompts::text) <= 4000),
  add constraint profiles_values_answers_shape
    check (jsonb_typeof(values_answers) = 'object' and octet_length(values_answers::text) <= 4000);

-- ---------------------------------------------------------------------------
-- 3. One pH ID, one account
-- ---------------------------------------------------------------------------
-- elitmus_ref_hash is an HMAC of the pH ID, never the ID. Two accounts cannot
-- share a hash. The column and elitmus_status are written only by the server
-- (service role); users have no update grant for them.
create unique index profiles_elitmus_ref_hash_key
  on public.profiles (elitmus_ref_hash)
  where elitmus_ref_hash is not null;

-- ---------------------------------------------------------------------------
-- 4. Photo storage
-- ---------------------------------------------------------------------------
-- A private bucket (nobody gets a public URL) that accepts only small images.
-- Files live at <user id>/<random name>. The 5 MB limit is a ceiling; the app
-- compresses in the browser first so real files are far smaller.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos', 'profile-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- The user id in the first folder of a file path, or null if it is not an id.
create function public.photo_owner(path text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(path, '/', 1)::uuid
  end;
$$;

-- Read: your own photos, or photos of someone you may see (same rule as the
-- profile itself: an intro or a conversation, no blocks).
create policy profile_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and public.photo_owner(name) is not null
    and public.can_see_profile(public.photo_owner(name))
  );

-- Write: only into your own folder, and no more than 8 files there. The app
-- allows 4 photos; the extra room is for uploads that were never saved.
create policy profile_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and public.photo_owner(name) = auth.uid()
    and (
      select count(*) from storage.objects o
       where o.bucket_id = 'profile-photos'
         and public.photo_owner(o.name) = auth.uid()
    ) < 8
  );

create policy profile_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos' and public.photo_owner(name) = auth.uid())
  with check (bucket_id = 'profile-photos' and public.photo_owner(name) = auth.uid());

create policy profile_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and public.photo_owner(name) = auth.uid());
