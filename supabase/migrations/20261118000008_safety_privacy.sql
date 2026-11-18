-- Shortlist: safety, privacy and legal tools.
--
-- The earlier migrations are already applied, so everything new is here.
--
-- What is added:
--   1. reports.evidence (a copy of chat messages the reporter chose to attach),
--      and reports can no longer be written or changed straight from the API.
--   2. block_user()            block someone: both vanish, live chats end.
--   3. report_user()           file a report (rate limited, optional evidence).
--   4. end_kept_conversation() close a kept chat kindly.
--   5. admin_get_report(), admin_resolve_report(), admin_unsuspend_user():
--      the moderation queue, each change written to audit_log in the same
--      transaction.
--   6. contact_messages + submit_contact_message() + admin_mark_contact_handled().
--   7. set_consent()           give or withdraw an optional consent.
--   8. export_my_data()        everything that is the caller's own, as JSON.
--   9. delete_account()        remove a person, keeping only a minimal safety record.
--
-- Why service_role only (same reasoning as decide_intro and send_message):
-- the limits come from config/safety.ts and are passed in as parameters, and
-- the person is taken from the verified session by our server. If a signed-in
-- user could call these directly they could pass a limit of 1000 or someone
-- else's id. The functions still check who they are acting for.
--
-- Concurrency: block_user and delete_account take the same per-person advisory
-- lock as decide_intro ("shortlist:<id>"), always smaller id first, so a block
-- and an "Interested" click on the same pair cannot interleave.

-- ---------------------------------------------------------------------------
-- 1. Reports: evidence column, no direct writes
-- ---------------------------------------------------------------------------
alter table public.reports
  add column evidence jsonb
    check (evidence is null or jsonb_typeof(evidence) = 'array');

-- A reporter used to insert a report row directly. Now the row is written by
-- report_user(), which counts recent reports (rate limit) and copies the
-- evidence itself, so a reporter cannot invent "evidence". Status changes go
-- through admin_resolve_report() so every one is audited.
drop policy reports_insert_reporter on public.reports;
drop policy reports_update_admin on public.reports;
revoke insert, update, select on public.reports from authenticated;

-- Admins can list reports with their own session, but the evidence column is
-- left out: it is opened one report at a time through admin_get_report(),
-- which records that it was opened.
grant select (
  id, reporter_id, target_id, conversation_id, reason, details, status,
  created_at, ack_at, resolved_at, admin_note
) on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helper: do these two people have any link (an intro or a chat)?
-- ---------------------------------------------------------------------------
-- Used so that block / report cannot be pointed at a stranger: the answer for
-- "no link" and "no such person" is the same error, so ids cannot be probed.
create function public.people_connected(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.intros i
            where (i.viewer_id = p_a and i.candidate_id = p_b)
               or (i.viewer_id = p_b and i.candidate_id = p_a))
      or exists (
           select 1 from public.conversations c
            where (c.user_a = p_a and c.user_b = p_b)
               or (c.user_a = p_b and c.user_b = p_a));
$$;
revoke execute on function public.people_connected(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Internal helper: one advisory lock per person, smaller id first (the same
-- keys decide_intro uses).
create function public.lock_pair(p_a uuid, p_b uuid)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('shortlist:' || least(p_a::text, p_b::text), 0));
  if p_a <> p_b then
    perform pg_advisory_xact_lock(hashtextextended('shortlist:' || greatest(p_a::text, p_b::text), 0));
  end if;
end;
$$;
revoke execute on function public.lock_pair(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. block_user()
-- ---------------------------------------------------------------------------
-- Blocking is one-way to set and two-way in effect: neither person can see the
-- other, chat, or be matched again (the profile policy, the chat rules and the
-- drop filter all read the blocks table). On top of that this function:
--   * ends every live chat between them at once (status "blocked"), which also
--     frees the cap slot for both people. No reply rate is counted for it: a
--     block says nothing about how responsive either person was.
--   * marks their still-unanswered intros for each other as expired, so the
--     "left to answer" counter on the Shortlist stays right.
-- A repeated block is a no-op and does not count against the rate limit.
-- Returns jsonb: already (was blocked before), ended (chats ended),
-- freed_user_ids (the people whose slot was freed; the app retries their
-- waiting matches).
-- Errors: bad_target, target_not_found, rate_limited
create function public.block_user(
  p_blocker uuid,
  p_target uuid,
  p_now timestamptz default now(),
  p_max_per_day integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  was_blocked boolean;
  recent integer;
  c record;
  n integer := 0;
begin
  if p_blocker is null or p_target is null or p_blocker = p_target then
    raise exception 'bad_target' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.profiles where id = p_blocker and deleted_at is null) then
    raise exception 'bad_target' using errcode = 'invalid_parameter_value';
  end if;

  perform public.lock_pair(p_blocker, p_target);

  if not exists (select 1 from public.profiles where id = p_target)
     or not public.people_connected(p_blocker, p_target) then
    raise exception 'target_not_found' using errcode = 'no_data_found';
  end if;

  select exists (select 1 from public.blocks
                  where blocker_id = p_blocker and blocked_id = p_target)
    into was_blocked;

  if not was_blocked then
    select count(*) into recent from public.blocks
     where blocker_id = p_blocker and created_at > p_now - interval '24 hours';
    if recent >= p_max_per_day then
      raise exception 'rate_limited' using errcode = 'configuration_limit_exceeded';
    end if;
    insert into public.blocks (blocker_id, blocked_id, created_at)
    values (p_blocker, p_target, p_now);
  end if;

  for c in
    select id from public.conversations
     where status in ('open', 'kept')
       and least(user_a, user_b) = least(p_blocker, p_target)
       and greatest(user_a, user_b) = greatest(p_blocker, p_target)
     for update
  loop
    update public.conversations
       set status = 'blocked', closed_by = p_blocker, closed_at = p_now
     where id = c.id;
    n := n + 1;
  end loop;

  update public.intros
     set status = 'expired'
   where status = 'new'
     and ((viewer_id = p_blocker and candidate_id = p_target)
       or (viewer_id = p_target and candidate_id = p_blocker));

  return jsonb_build_object(
    'already', was_blocked,
    'ended', n,
    'freed_user_ids', case when n > 0 then jsonb_build_array(p_blocker, p_target) else '[]'::jsonb end
  );
end;
$$;
revoke execute on function public.block_user(uuid, uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.block_user(uuid, uuid, timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. report_user()
-- ---------------------------------------------------------------------------
-- Evidence design: the reporter does not send message text. They only say
-- "attach this conversation". This function reads the last N messages of that
-- conversation itself, after checking that the reporter and the reported
-- person are the two people in it, and stores a copy on the report. So:
--   * a reporter cannot forge or edit "evidence";
--   * admins get no blanket access to messages, only to what a report carries;
--   * nothing is attached unless the reporter ticked the box.
-- The copy is labelled "reporter" / "reported", with no names or ids.
-- Reporting is allowed after a chat has ended or the person was blocked (the
-- reporter was a participant, so they saw these messages).
-- Returns jsonb: id, status ("received" or "already_reported"), evidence_count.
-- A second report about the same person while an earlier one from you is still
-- open (within 24 hours) returns the first one instead of adding another.
-- Errors: bad_target, target_not_found, conversation_not_found, bad_reason,
--   bad_details, bad_attach, rate_limited
create function public.report_user(
  p_reporter uuid,
  p_target uuid,
  p_conversation uuid,
  p_reason text,
  p_details text,
  p_attach boolean default false,
  p_now timestamptz default now(),
  p_max_per_day integer default 5,
  p_max_evidence integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_reason public.report_reason;
  existing uuid;
  recent integer;
  ev jsonb := null;
  ev_count integer := 0;
  new_id uuid;
begin
  if p_reporter is null or p_target is null or p_reporter = p_target then
    raise exception 'bad_target' using errcode = 'invalid_parameter_value';
  end if;
  begin
    v_reason := p_reason::public.report_reason;
  exception when others then
    raise exception 'bad_reason' using errcode = 'invalid_parameter_value';
  end;
  if v_details is not null
     and (char_length(v_details) > 1000 or translate(v_details, E'\n\t', '') ~ '[[:cntrl:]]') then
    raise exception 'bad_details' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_attach, false) and p_conversation is null then
    raise exception 'bad_attach' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.profiles where id = p_reporter and deleted_at is null) then
    raise exception 'bad_target' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || p_reporter::text, 0));

  if not exists (select 1 from public.profiles where id = p_target)
     or not public.people_connected(p_reporter, p_target) then
    raise exception 'target_not_found' using errcode = 'no_data_found';
  end if;

  if p_conversation is not null and not exists (
       select 1 from public.conversations c
        where c.id = p_conversation
          and least(c.user_a, c.user_b) = least(p_reporter, p_target)
          and greatest(c.user_a, c.user_b) = greatest(p_reporter, p_target)) then
    raise exception 'conversation_not_found' using errcode = 'no_data_found';
  end if;

  select id into existing from public.reports
   where reporter_id = p_reporter and target_id = p_target
     and status in ('open', 'ack')
     and created_at > p_now - interval '24 hours'
   order by created_at desc limit 1;
  if existing is not null then
    return jsonb_build_object('id', existing, 'status', 'already_reported', 'evidence_count', 0);
  end if;

  select count(*) into recent from public.reports
   where reporter_id = p_reporter and created_at > p_now - interval '24 hours';
  if recent >= p_max_per_day then
    raise exception 'rate_limited' using errcode = 'configuration_limit_exceeded';
  end if;

  if coalesce(p_attach, false) then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'at', m.created_at,
               'from', case when m.sender_id = p_reporter then 'reporter' else 'reported' end,
               'body', m.body)
             order by m.created_at, m.id), '[]'::jsonb)
      into ev
      from (select * from public.messages
             where conversation_id = p_conversation
             order by created_at desc, id desc
             limit p_max_evidence) m;
    ev_count := jsonb_array_length(ev);
  end if;

  insert into public.reports
    (reporter_id, target_id, conversation_id, reason, details, status, created_at, evidence)
  values
    (p_reporter, p_target, p_conversation, v_reason, v_details, 'open', p_now, ev)
  returning id into new_id;

  return jsonb_build_object('id', new_id, 'status', 'received', 'evidence_count', ev_count);
end;
$$;
revoke execute on function public.report_user(uuid, uuid, uuid, text, text, boolean, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.report_user(uuid, uuid, uuid, text, text, boolean, timestamptz, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. end_kept_conversation()
-- ---------------------------------------------------------------------------
-- Either person can end a kept chat. Like closing on day 3 it is final and
-- the other person sees only a kind note chosen from our own templates. The
-- reply rate was counted when the chat was kept, so it is not counted again.
-- Returns jsonb: other_id (the app retries that person's and your waiting
-- matches). Errors: bad_note, conversation_not_found, not_kept
create function public.end_kept_conversation(
  p_user uuid,
  p_conversation uuid,
  p_note text default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  c public.conversations;
begin
  if v_note is not null and (char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]') then
    raise exception 'bad_note' using errcode = 'invalid_parameter_value';
  end if;

  select * into c from public.conversations where id = p_conversation for update;
  if not found or p_user not in (c.user_a, c.user_b) then
    raise exception 'conversation_not_found' using errcode = 'no_data_found';
  end if;
  if c.status <> 'kept' then
    raise exception 'not_kept' using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.conversations
     set status = 'closed', closed_by = p_user, closed_at = p_now, closed_reason = v_note
   where id = c.id;

  return jsonb_build_object(
    'other_id', case when p_user = c.user_a then c.user_b else c.user_a end
  );
end;
$$;
revoke execute on function public.end_kept_conversation(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.end_kept_conversation(uuid, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Internal helper: is this person an active admin?
-- ---------------------------------------------------------------------------
create function public.assert_active_admin(p_admin uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
     where id = p_admin and role = 'admin'
       and suspended_at is null and deleted_at is null
  ) then
    raise exception 'not_admin' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke execute on function public.assert_active_admin(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5a. admin_get_report(): open one report
-- ---------------------------------------------------------------------------
-- Returns what the report carries: the reason, the reporter's words, both
-- display names and, only when p_with_evidence is true AND the reporter
-- attached some, the evidence. Opening evidence is itself written to
-- audit_log ("report_evidence_viewed"). Nothing else about either person
-- (no profile, no other chats) is returned.
-- Errors: not_admin, report_not_found
create function public.admin_get_report(
  p_admin uuid,
  p_report uuid,
  p_with_evidence boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reports;
  reporter_name text;
  target_name text;
  target_suspended boolean;
  others integer;
  show_evidence boolean;
begin
  perform public.assert_active_admin(p_admin);
  select * into r from public.reports where id = p_report;
  if not found then
    raise exception 'report_not_found' using errcode = 'no_data_found';
  end if;

  select display_name into reporter_name from public.profiles where id = r.reporter_id;
  select display_name, suspended_at is not null into target_name, target_suspended
    from public.profiles where id = r.target_id;
  select count(*) into others from public.reports
   where target_id = r.target_id and id <> r.id and r.target_id is not null;

  show_evidence := coalesce(p_with_evidence, false) and r.evidence is not null;
  if show_evidence then
    insert into public.audit_log (admin_id, action, target, at)
    values (p_admin, 'report_evidence_viewed', 'report:' || r.id::text, p_now);
  end if;

  return jsonb_build_object(
    'id', r.id,
    'reason', r.reason,
    'details', r.details,
    'status', r.status,
    'created_at', r.created_at,
    'ack_at', r.ack_at,
    'resolved_at', r.resolved_at,
    'admin_note', r.admin_note,
    'reporter_id', r.reporter_id,
    'reporter_name', reporter_name,
    'target_id', r.target_id,
    'target_name', target_name,
    'target_suspended', coalesce(target_suspended, false),
    'other_reports_about_target', others,
    'has_evidence', r.evidence is not null,
    'evidence', case when show_evidence then r.evidence end
  );
end;
$$;
revoke execute on function public.admin_get_report(uuid, uuid, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_get_report(uuid, uuid, boolean, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5b. admin_resolve_report(): acknowledge, act on, or dismiss
-- ---------------------------------------------------------------------------
-- ack      open -> ack (sets ack_at; the reporter was heard within the SLA)
-- action   open/ack -> actioned; with p_suspend the reported person is also
--          suspended (profile hidden everywhere, live chats ended, cannot use
--          the app), all in this one transaction with the audit rows
-- dismiss  open/ack -> dismissed
-- A report that is already actioned or dismissed cannot be changed.
-- Returns jsonb: status, suspended, freed_user_ids.
-- Errors: not_admin, bad_action, bad_note, report_not_found, already_resolved,
--   already_acknowledged, cannot_suspend, target_gone
create function public.admin_resolve_report(
  p_admin uuid,
  p_report uuid,
  p_action text,
  p_note text default null,
  p_suspend boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r public.reports;
  t public.profiles;
  suspended boolean := false;
  freed jsonb := '[]'::jsonb;
  c record;
begin
  perform public.assert_active_admin(p_admin);
  if p_action not in ('ack', 'action', 'dismiss') then
    raise exception 'bad_action' using errcode = 'invalid_parameter_value';
  end if;
  if v_note is not null
     and (char_length(v_note) > 1000 or translate(v_note, E'\n\t', '') ~ '[[:cntrl:]]') then
    raise exception 'bad_note' using errcode = 'invalid_parameter_value';
  end if;

  select * into r from public.reports where id = p_report for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'no_data_found';
  end if;
  if r.status in ('actioned', 'dismissed') then
    raise exception 'already_resolved' using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_action = 'ack' then
    if r.status = 'ack' then
      raise exception 'already_acknowledged' using errcode = 'object_not_in_prerequisite_state';
    end if;
    update public.reports
       set status = 'ack', ack_at = p_now, admin_note = coalesce(v_note, admin_note)
     where id = r.id;
    insert into public.audit_log (admin_id, action, target, at)
    values (p_admin, 'report_acknowledged', 'report:' || r.id::text, p_now);
    return jsonb_build_object('status', 'ack', 'suspended', false, 'freed_user_ids', freed);
  end if;

  if p_suspend and p_action = 'action' then
    if r.target_id is null then
      raise exception 'target_gone' using errcode = 'no_data_found';
    end if;
    select * into t from public.profiles where id = r.target_id for update;
    if not found then
      raise exception 'target_gone' using errcode = 'no_data_found';
    end if;
    if t.role = 'admin' then
      raise exception 'cannot_suspend' using errcode = 'insufficient_privilege';
    end if;
    update public.profiles
       set suspended_at = coalesce(suspended_at, p_now)
     where id = t.id;
    suspended := true;
    -- Their live chats end now; the other person's slot is free again.
    for c in
      select id, user_a, user_b from public.conversations
       where status in ('open', 'kept') and t.id in (user_a, user_b)
       for update
    loop
      update public.conversations
         set status = 'closed', closed_by = null, closed_at = p_now
       where id = c.id;
      freed := freed || to_jsonb(case when c.user_a = t.id then c.user_b else c.user_a end);
    end loop;
    insert into public.audit_log (admin_id, action, target, at)
    values (p_admin, 'user_suspended', 'profile:' || t.id::text, p_now);
  end if;

  update public.reports
     set status = case when p_action = 'action' then 'actioned'::public.report_status
                       else 'dismissed'::public.report_status end,
         ack_at = coalesce(ack_at, p_now),
         resolved_at = p_now,
         admin_note = coalesce(v_note, admin_note)
   where id = r.id;
  insert into public.audit_log (admin_id, action, target, at)
  values (p_admin,
          case when p_action = 'action' then 'report_actioned' else 'report_dismissed' end,
          'report:' || r.id::text, p_now);

  return jsonb_build_object(
    'status', case when p_action = 'action' then 'actioned' else 'dismissed' end,
    'suspended', suspended,
    'freed_user_ids', freed
  );
end;
$$;
revoke execute on function public.admin_resolve_report(uuid, uuid, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_resolve_report(uuid, uuid, text, text, boolean, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5c. admin_unsuspend_user(): undo a suspension (a mistake can be corrected)
-- ---------------------------------------------------------------------------
-- Ended chats stay ended. Errors: not_admin, not_suspended
create function public.admin_unsuspend_user(
  p_admin uuid,
  p_target uuid,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_active_admin(p_admin);
  update public.profiles set suspended_at = null
   where id = p_target and suspended_at is not null;
  if not found then
    raise exception 'not_suspended' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (admin_id, action, target, at)
  values (p_admin, 'user_unsuspended', 'profile:' || p_target::text, p_now);
end;
$$;
revoke execute on function public.admin_unsuspend_user(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_unsuspend_user(uuid, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Contact messages (the "contact us" form on the grievance page)
-- ---------------------------------------------------------------------------
-- Anyone can write to us, signed in or not. The form posts to our server,
-- which calls submit_contact_message(). Rate limits stop it being used to
-- flood the admins: a few per sender per day and a ceiling for everybody.
-- sender_key is a hash of the email (or the user id), used only for counting.
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  sender_key text not null,
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 200),
  message text not null check (char_length(message) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'handled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null
);
create index contact_messages_status_idx on public.contact_messages (status, created_at);
create index contact_messages_sender_idx on public.contact_messages (sender_key, created_at);

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;
grant select on public.contact_messages to authenticated;
create policy contact_messages_select_admin on public.contact_messages
  for select to authenticated using (public.is_admin());

-- Returns jsonb: id. Errors: bad_message, rate_limited
create function public.submit_contact_message(
  p_user uuid,
  p_name text,
  p_email text,
  p_message text,
  p_sender_key text,
  p_now timestamptz default now(),
  p_per_sender_per_day integer default 3,
  p_global_per_day integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
  v_message text := btrim(coalesce(p_message, ''));
  mine integer;
  everyone integer;
  new_id uuid;
begin
  if char_length(v_name) not between 1 and 100
     or char_length(v_email) not between 3 and 200
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or char_length(v_message) not between 10 and 2000
     or translate(v_message, E'\n\t', '') ~ '[[:cntrl:]]'
     or p_sender_key is null or p_sender_key = '' then
    raise exception 'bad_message' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('contact:all', 0));
  select count(*) filter (where sender_key = p_sender_key), count(*)
    into mine, everyone
    from public.contact_messages where created_at > p_now - interval '24 hours';
  if mine >= p_per_sender_per_day or everyone >= p_global_per_day then
    raise exception 'rate_limited' using errcode = 'configuration_limit_exceeded';
  end if;

  insert into public.contact_messages (user_id, sender_key, name, email, message, created_at)
  values (p_user, p_sender_key, v_name, v_email, v_message, p_now)
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;
revoke execute on function public.submit_contact_message(uuid, text, text, text, text, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.submit_contact_message(uuid, text, text, text, text, timestamptz, integer, integer)
  to service_role;

-- Errors: not_admin, not_open
create function public.admin_mark_contact_handled(
  p_admin uuid,
  p_message uuid,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_active_admin(p_admin);
  update public.contact_messages
     set status = 'handled', handled_at = p_now, handled_by = p_admin
   where id = p_message and status = 'open';
  if not found then
    raise exception 'not_open' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (admin_id, action, target, at)
  values (p_admin, 'contact_handled', 'contact:' || p_message::text, p_now);
end;
$$;
revoke execute on function public.admin_mark_contact_handled(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_mark_contact_handled(uuid, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. set_consent(): give or withdraw a consent
-- ---------------------------------------------------------------------------
-- consents is an append-only history: the current answer for a kind is its
-- newest row. Rules:
--   * marketing and elitmus_data_sharing can be withdrawn; marketing can be
--     given again. (elitmus_data_sharing is given again by asking for
--     verification, which records it.)
--   * withdrawing elitmus_data_sharing also unlinks verification: status back
--     to "none" and the stored hash forgotten, in the same transaction.
--   * terms and privacy cannot be withdrawn (leaving means deleting the
--     account); they can be accepted again for a newer version.
-- Returns jsonb: changed (false when it already was that way).
-- Errors: bad_kind, cannot_withdraw, use_verification_form, bad_version
create function public.set_consent(
  p_user uuid,
  p_kind text,
  p_granted boolean,
  p_version text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.consent_kind;
  latest boolean;
begin
  begin
    k := p_kind::public.consent_kind;
  exception when others then
    raise exception 'bad_kind' using errcode = 'invalid_parameter_value';
  end;
  if p_version is null or char_length(p_version) not between 1 and 40 then
    raise exception 'bad_version' using errcode = 'invalid_parameter_value';
  end if;
  if k in ('terms', 'privacy') and not p_granted then
    raise exception 'cannot_withdraw' using errcode = 'invalid_parameter_value';
  end if;
  if k = 'elitmus_data_sharing' and p_granted then
    raise exception 'use_verification_form' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is null) then
    raise exception 'bad_kind' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('consent:' || p_user::text, 0));
  select granted into latest from public.consents
   where user_id = p_user and kind = k order by at desc, id desc limit 1;

  -- Terms and privacy are re-accepted per version, so they always add a row.
  if latest is not distinct from p_granted and k not in ('terms', 'privacy') then
    return jsonb_build_object('changed', false);
  end if;

  insert into public.consents (user_id, kind, policy_version, granted, at)
  values (p_user, k, p_version, p_granted, p_now);

  if k = 'elitmus_data_sharing' and not p_granted then
    update public.profiles
       set elitmus_status = 'none', elitmus_ref_hash = null
     where id = p_user;
  end if;
  return jsonb_build_object('changed', true);
end;
$$;
revoke execute on function public.set_consent(uuid, text, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_consent(uuid, text, boolean, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. export_my_data(): the caller's own data
-- ---------------------------------------------------------------------------
-- Returns only what belongs to p_user:
--   * their profile (no internal columns: role, the pH hash, moderation
--     times) and their sign-in email;
--   * consents, orders, their own events, contact messages they sent;
--   * the intros they were shown (status and their own note, but NOT who the
--     other person was) and their chats (state and their own decision, NOT who
--     the other person was);
--   * only the messages they wrote themselves;
--   * reports they filed (reason, their words, status; not the admin's note,
--     not the evidence copy), and a count of blocks (not who).
-- Other people's names, photos, messages and answers are never included.
-- At most p_max_per_day exports a day; each one writes a "data_export" event.
-- Errors: not_found, rate_limited
create function public.export_my_data(
  p_user uuid,
  p_now timestamptz default now(),
  p_max_per_day integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  mail text;
  recent integer;
  result jsonb;
begin
  select * into me from public.profiles where id = p_user and deleted_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('export:' || p_user::text, 0));
  select count(*) into recent from public.events
   where user_id = p_user and name = 'data_export' and at > p_now - interval '24 hours';
  if recent >= p_max_per_day then
    raise exception 'rate_limited' using errcode = 'configuration_limit_exceeded';
  end if;
  insert into public.events (user_id, name, props, at) values (p_user, 'data_export', '{}', p_now);

  select email into mail from auth.users where id = p_user;

  result := jsonb_build_object(
    'exported_at', p_now,
    'account', jsonb_build_object(
      'email', mail,
      'created_at', me.created_at,
      'status', case when me.suspended_at is not null then 'suspended'
                     when me.paused then 'paused' else 'active' end
    ),
    'profile', jsonb_build_object(
      'display_name', me.display_name,
      'date_of_birth', me.dob,
      'gender', me.gender,
      'interested_in', me.interested_in,
      'city', me.city,
      'intent', me.intent,
      'batch_year', me.batch_year,
      'college_tier', me.college_tier,
      'occupation', me.occupation,
      'prompts', me.bio_prompts,
      'values_answers', me.values_answers,
      'interests', me.interests,
      'photo_files', me.photos,
      'email_verified', me.verified_email,
      'elitmus_verification', me.elitmus_status,
      'paused', me.paused,
      'plus_until', me.plus_until,
      'reply_rate', jsonb_build_object('replied', me.reply_rate_num, 'out_of', me.reply_rate_den),
      'onboarding_completed_at', me.onboarding_completed_at
    ),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'granted', c.granted,
                                          'policy_version', c.policy_version, 'at', c.at)
                       order by c.at, c.id)
        from public.consents c where c.user_id = p_user), '[]'::jsonb),
    'intros_shown_to_me', coalesce((
      select jsonb_agg(jsonb_build_object('shown_at', i.created_at, 'status', i.status,
                                          'my_note', i.note, 'answered_at', i.decided_at)
                       order by i.created_at, i.id)
        from public.intros i where i.viewer_id = p_user), '[]'::jsonb),
    'chats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'chat_id', c.id,
               'status', c.status,
               'opened_at', c.opened_at,
               'ended_at', c.closed_at,
               'i_opened_it', c.opener_id = p_user,
               'my_decision', case when p_user = c.user_a then c.a_decision else c.b_decision end,
               'i_ended_it', c.closed_by = p_user)
             order by c.opened_at, c.id)
        from public.conversations c where p_user in (c.user_a, c.user_b)), '[]'::jsonb),
    'messages_i_wrote', coalesce((
      select jsonb_agg(jsonb_build_object('chat_id', m.conversation_id, 'sent_at', m.created_at,
                                          'text', m.body)
                       order by m.created_at, m.id)
        from public.messages m where m.sender_id = p_user), '[]'::jsonb),
    'people_i_blocked', (select count(*) from public.blocks b where b.blocker_id = p_user),
    'reports_i_filed', coalesce((
      select jsonb_agg(jsonb_build_object('filed_at', r.created_at, 'reason', r.reason,
                                          'my_words', r.details, 'status', r.status,
                                          'resolved_at', r.resolved_at,
                                          'chat_attached', r.evidence is not null)
                       order by r.created_at, r.id)
        from public.reports r where r.reporter_id = p_user), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('plan', o.plan, 'amount_paise', o.amount_paise,
                                          'status', o.status, 'created_at', o.created_at,
                                          'razorpay_order_id', o.razorpay_order_id,
                                          'razorpay_payment_id', o.razorpay_payment_id)
                       order by o.created_at, o.id)
        from public.orders o where o.user_id = p_user), '[]'::jsonb),
    'activity_events', coalesce((
      select jsonb_agg(jsonb_build_object('name', e.name, 'props', e.props, 'at', e.at)
                       order by e.at, e.id)
        from public.events e where e.user_id = p_user), '[]'::jsonb),
    'messages_i_sent_to_support', coalesce((
      select jsonb_agg(jsonb_build_object('name', cm.name, 'email', cm.email,
                                          'message', cm.message, 'sent_at', cm.created_at)
                       order by cm.created_at, cm.id)
        from public.contact_messages cm where cm.user_id = p_user), '[]'::jsonb)
  );
  return result;
end;
$$;
revoke execute on function public.export_my_data(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.export_my_data(uuid, timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. delete_account()
-- ---------------------------------------------------------------------------
-- Removes a person in ONE transaction. (Their photo files are removed by the
-- app just before this runs; storage files cannot be deleted from SQL.)
--
-- What goes: the sign-in account, profile, consents, intros, chats and every
-- message in them (including the other person's side of those chats, since a
-- chat cannot exist with one half), blocks, read markers, their events, their
-- contact messages, and the free text of reports about them.
-- What stays, and why:
--   * safety_records: ONE row per reason, with a salted hash of the person's
--     id, the reason and the time. No name, no email, no content. It is kept
--     only when they had a report against them that was open, acknowledged or
--     actioned, or were suspended, so deleting an account is not a way to
--     escape moderation. A dismissed report leaves nothing behind.
--   * reports they filed: the row stays without their id (so the other
--     person's case can be finished). Their words and the attached evidence
--     are kept while the report is open, acknowledged or actioned, and
--     removed when it was dismissed.
--   * reports about them: the row stays without their id (reason, status and
--     dates, for statistics), with the reporter's words, the evidence copy
--     and the admin note removed.
--   * orders: kept without their id (accounting and tax records).
--   * audit_log: rows stay (the log is append-only) but any "profile:<id>"
--     of the deleted person is rewritten to "deleted-user:<hash prefix>".
-- Idempotent: calling it again for a person who is gone returns
-- {"status": "already_gone"}. An admin account cannot be deleted this way.
-- Returns jsonb: status, freed_user_ids (people who had a live chat with them;
-- the app retries their waiting matches).
-- Errors: admin_account, bad_secret
create function public.delete_account(
  p_user uuid,
  p_pepper text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  v_hash text;
  freed jsonb;
begin
  if p_pepper is null or char_length(p_pepper) < 16 then
    raise exception 'bad_secret' using errcode = 'invalid_parameter_value';
  end if;

  perform public.lock_pair(p_user, p_user);

  select * into me from public.profiles where id = p_user;
  if not found then
    -- The profile is gone. Make sure the login is gone too (a half-finished
    -- earlier attempt), then report success.
    delete from auth.users where id = p_user;
    return jsonb_build_object('status', 'already_gone', 'freed_user_ids', '[]'::jsonb);
  end if;
  if me.role = 'admin' then
    raise exception 'admin_account' using errcode = 'insufficient_privilege';
  end if;

  v_hash := encode(sha256(convert_to(p_pepper || ':' || p_user::text, 'UTF8')), 'hex');

  select coalesce(jsonb_agg(distinct case when c.user_a = p_user then c.user_b else c.user_a end),
                  '[]'::jsonb)
    into freed
    from public.conversations c
   where c.status in ('open', 'kept') and p_user in (c.user_a, c.user_b);

  -- Minimal safety record, one row per reason.
  insert into public.safety_records (user_ref_hash, reason, at)
  select v_hash, 'report:' || r.reason::text, p_now
    from public.reports r
   where r.target_id = p_user and r.status in ('open', 'ack', 'actioned')
   group by r.reason;
  if me.suspended_at is not null then
    insert into public.safety_records (user_ref_hash, reason, at)
    values (v_hash, 'suspended', p_now);
  end if;

  -- Reports about them: keep the row, drop the free text and the evidence.
  update public.reports
     set details = null, evidence = null, admin_note = null
   where target_id = p_user;
  -- Reports they filed: drop the words only when it was dismissed.
  update public.reports
     set details = null, evidence = null, admin_note = null
   where reporter_id = p_user and status = 'dismissed';

  update public.audit_log
     set target = 'deleted-user:' || left(v_hash, 16)
   where target = 'profile:' || p_user::text;

  delete from public.events where user_id = p_user;
  delete from public.contact_messages where user_id = p_user;
  update public.orders set user_id = null where user_id = p_user;

  -- Deleting the login cascades to the profile and, through it, to intros,
  -- chats, messages, consents, blocks and read markers. Reports, events-like
  -- history and orders have "on delete set null", so their rows stay unlinked.
  delete from auth.users where id = p_user;

  return jsonb_build_object('status', 'deleted', 'freed_user_ids', freed);
end;
$$;
revoke execute on function public.delete_account(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.delete_account(uuid, text, timestamptz)
  to service_role;
