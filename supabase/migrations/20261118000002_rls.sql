-- Shortlist: Row Level Security.
--
-- Two layers protect every table:
--   1. GRANTs say which columns a role may touch at all.
--   2. POLICIES say which rows. With RLS on and no policy, nobody gets in.
--
-- Roles: "anon" is a visitor, "authenticated" is a signed-in user, and
-- "service_role" is the server (it skips RLS). The service key must never reach
-- the browser. Anything a user must not decide for themselves (matching,
-- opening conversations, payments, deletion, moderation) is done by the server.
--
-- Supabase hands out broad default privileges on new tables, so we first take
-- everything away and then grant back only what is needed.

revoke all on all tables in schema public from anon, authenticated;

alter table public.profiles       enable row level security;
alter table public.consents       enable row level security;
alter table public.drops          enable row level security;
alter table public.intros         enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.blocks         enable row level security;
alter table public.reports        enable row level security;
alter table public.safety_records enable row level security;
alter table public.orders         enable row level security;
alter table public.events         enable row level security;
alter table public.audit_log      enable row level security;

-- ---------------------------------------------------------------------------
-- Helper functions used by the policies
-- ---------------------------------------------------------------------------
-- They are "security definer" so they can look at other tables without those
-- tables' own policies getting in the way (and without policies calling each
-- other in circles).

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin' and suspended_at is null
  );
$$;

-- Can the signed-in user see this person's profile? Only if it is themselves,
-- they are an admin, or they have been shown this person in an intro or share
-- a conversation, and nobody has blocked anybody. There is no public browse.
create function public.can_see_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    target = auth.uid()
    or public.is_admin()
    or (
      not exists (
        select 1 from public.blocks b
         where (b.blocker_id = auth.uid() and b.blocked_id = target)
            or (b.blocker_id = target and b.blocked_id = auth.uid())
      )
      and exists (
        select 1 from public.profiles p
         where p.id = target and p.deleted_at is null and p.suspended_at is null
      )
      and (
        exists (
          select 1 from public.intros i
           where i.viewer_id = auth.uid() and i.candidate_id = target
        )
        or exists (
          select 1 from public.conversations c
           where (c.user_a = auth.uid() and c.user_b = target)
              or (c.user_b = auth.uid() and c.user_a = target)
        )
      )
    ),
    false
  );
$$;

-- Age in years of someone you are allowed to see. The birth date itself is not
-- readable by other users (see the column grants below), only this number.
create function public.profile_age(target uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.can_see_profile(target)
              then public.age_on(p.dob, current_date) end
    from public.profiles p
   where p.id = target;
$$;

revoke execute on function public.is_admin(), public.can_see_profile(uuid), public.profile_age(uuid)
  from public, anon;
grant execute on function public.is_admin(), public.can_see_profile(uuid), public.profile_age(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Read: self, admin, or someone you have an intro or conversation with.
-- Not readable by anyone but the server: dob and elitmus_ref_hash.
grant select (
  id, role, display_name, gender, interested_in, city, intent, batch_year,
  college_tier, occupation, bio_prompts, values_answers, interests, photos,
  verified_email, elitmus_status, paused, suspended_at, plus_until,
  reply_rate_num, reply_rate_den, created_at, deleted_at
) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_see_profile(id));

-- Update: your own row, and only these columns. role, plus_until,
-- elitmus_status, verified_email, suspended_at, dob and the reply-rate counters
-- are NOT in the list, so a user cannot promote themselves. Trying gives
-- "permission denied". No insert or delete grant exists: the signup trigger
-- creates the row and the server deletes accounts.
grant update (
  display_name, gender, interested_in, city, intent, batch_year, college_tier,
  occupation, bio_prompts, values_answers, interests, photos, paused
) on public.profiles to authenticated;

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- consents: you can read your own history and add a new decision. Rows are
-- never edited or deleted, so the history stays honest.
-- ---------------------------------------------------------------------------
grant select on public.consents to authenticated;
grant insert (user_id, kind, policy_version, granted) on public.consents to authenticated;

create policy consents_select_own on public.consents
  for select to authenticated using (user_id = auth.uid());

create policy consents_insert_own on public.consents
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- drops: server only. Admins can read them for the stats screen.
-- ---------------------------------------------------------------------------
grant select on public.drops to authenticated;
create policy drops_select_admin on public.drops
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- intros: you see only the intros you were shown. The candidate cannot see that
-- someone was shown their profile. Pass/interested is written by the server so
-- it can apply the weekly cap and the woman-first rule.
-- ---------------------------------------------------------------------------
grant select on public.intros to authenticated;
create policy intros_select_viewer on public.intros
  for select to authenticated
  using (viewer_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- conversations: participants (and admins) can read. Opening, keeping and
-- closing is done by the server.
-- ---------------------------------------------------------------------------
grant select on public.conversations to authenticated;
create policy conversations_select_participant on public.conversations
  for select to authenticated
  using (auth.uid() in (user_a, user_b) or public.is_admin());

-- ---------------------------------------------------------------------------
-- messages: only the two participants, and only while the conversation is open
-- or kept. Admins get no blanket read access; a moderator opens the messages
-- attached to a report through the server.
-- ---------------------------------------------------------------------------
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;

create policy messages_select_participant on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
       where c.id = messages.conversation_id
         and auth.uid() in (c.user_a, c.user_b)
         and c.status in ('open', 'kept')
    )
  );

-- Send: as yourself, into your own live conversation. An open conversation
-- stops accepting messages once its window has ended.
create policy messages_insert_participant on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
       where c.id = messages.conversation_id
         and auth.uid() in (c.user_a, c.user_b)
         and (c.status = 'kept' or (c.status = 'open' and c.window_ends_at > now()))
    )
  );

-- ---------------------------------------------------------------------------
-- blocks: owned by the blocker. You can see, add and remove your own blocks.
-- (The blocked person cannot see that they were blocked.)
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.blocks to authenticated;

create policy blocks_select_own on public.blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (blocker_id = auth.uid() and blocked_id <> auth.uid());
create policy blocks_delete_own on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- ---------------------------------------------------------------------------
-- reports: a reporter can file one (about someone they can see) but never read
-- it back. Admins read the queue and update its status columns.
-- ---------------------------------------------------------------------------
grant select on public.reports to authenticated;
grant insert (reporter_id, target_id, conversation_id, reason, details)
  on public.reports to authenticated;
grant update (status, ack_at, resolved_at, admin_note) on public.reports to authenticated;

create policy reports_insert_reporter on public.reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and target_id <> auth.uid()
    and public.can_see_profile(target_id)
  );
create policy reports_select_admin on public.reports
  for select to authenticated using (public.is_admin());
create policy reports_update_admin on public.reports
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- safety_records: server only. RLS on, no grants, no policies.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- orders: you can read your own. Created and updated only by the server after
-- the payment provider confirms.
-- ---------------------------------------------------------------------------
grant select on public.orders to authenticated;
create policy orders_select_own on public.orders
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- events and audit_log: written by the server, read by admins.
-- ---------------------------------------------------------------------------
grant select on public.events to authenticated;
create policy events_select_admin on public.events
  for select to authenticated using (public.is_admin());

grant select on public.audit_log to authenticated;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated using (public.is_admin());
