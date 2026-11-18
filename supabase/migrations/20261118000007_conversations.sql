-- Shortlist: conversations (sending messages, deciding, expiry).
--
-- The earlier migrations are already applied, so everything new is here.
--
-- What is added:
--   1. closed_by / closed_at on conversations, an index for the rate limit.
--   2. Messages can no longer be inserted directly by a signed-in user. They
--      go through send_message(), which checks the rules and the rate limit.
--   3. Column-level read grants, so a person cannot read the other person's
--      Keep/Close choice (or a moderation flag) through the API.
--   4. conversation_reads: when each person last read each chat (unread
--      marker). Only the owner can read their own row.
--   5. send_message(), record_decision(), expire_conversations() and the
--      internal finish_conversation(), which also updates the reply rates.
--   6. get_conversation(), my_conversation_summaries(), mark_conversation_read().
--   7. Realtime: the messages table joins the "supabase_realtime" publication.
--
-- The rules in plain words (the TypeScript twin is lib/conversation/state.ts;
-- a test runs the same cases through both):
--   * Messages: only a participant of an "open" chat whose window has not
--     ended, or of a "kept" chat. The opener writes first. The opener can send
--     up to p_max_before_reply messages before the first reply. Nobody can
--     send if either person blocked the other or an account is suspended or
--     deleted. Blank, too long, or containing control characters is refused.
--     A sender is limited to p_per_minute messages a minute and p_per_hour an
--     hour, counted from the messages table (no memory needed).
--   * Decision: once both have written and p_decision_after_hours have passed
--     since the chat opened (day 3), each person records keep or close.
--     Both keep -> kept. Either closes -> closed straight away, with a kind
--     note for the other person. One keep alone never keeps a chat.
--   * Expiry: an open chat whose window has ended becomes "expired".
--   * Whenever a chat leaves "open" the reply rate is updated once: the
--     opener always owes the first message; the other person owes a reply only
--     if the opener wrote. den + 1 each, num + 1 if they sent one.
--
-- Why service_role only for send_message / record_decision / expire: the
-- limits and times come from config/conversation.ts and are passed in as
-- parameters. If a signed-in user could call them they could pass a limit of
-- 1000. Only our server can call them; it takes the person from the verified
-- session. The functions still check that the person belongs to the chat.
--
-- Concurrency: each function locks the chat row (select ... for update), so
-- two sends, a decision and the expiry job on the same chat queue up. The
-- rate limit takes one advisory lock per sender so two chats cannot both slip
-- under the limit.

-- ---------------------------------------------------------------------------
-- 1. New columns and an index
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column closed_by uuid references public.profiles (id) on delete set null,
  add column closed_at timestamptz;

create index messages_sender_idx on public.messages (sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. No direct inserts into messages
-- ---------------------------------------------------------------------------
drop policy messages_insert_participant on public.messages;
revoke insert on public.messages from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Column-level reads
-- ---------------------------------------------------------------------------
-- messages.flagged is for moderators. conversations.a_decision / b_decision are
-- private until a chat is settled: the other person must not learn that
-- someone chose Keep or Close before they choose themselves. The app reads
-- your own choice through get_conversation().
revoke select on public.messages from authenticated;
grant select (id, conversation_id, sender_id, body, created_at)
  on public.messages to authenticated;

revoke select on public.conversations from authenticated;
grant select (
  id, user_a, user_b, opener_id, origin_intro_a, origin_intro_b, status,
  opened_at, window_ends_at, closed_reason, closed_by, closed_at
) on public.conversations to authenticated;

-- ---------------------------------------------------------------------------
-- 4. conversation_reads: the unread marker
-- ---------------------------------------------------------------------------
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from anon, authenticated;
-- You can read only your own row. Nobody gets a write grant: the row is
-- written by mark_conversation_read(). The other person never sees it, so
-- there are no read receipts.
grant select on public.conversation_reads to authenticated;
create policy conversation_reads_select_own on public.conversation_reads
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Internal helper: can these two people still write to each other?
-- ---------------------------------------------------------------------------
create function public.chat_unavailable(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.blocks b
            where (b.blocker_id = p_a and b.blocked_id = p_b)
               or (b.blocker_id = p_b and b.blocked_id = p_a))
      or exists (
           select 1 from public.profiles p
            where p.id in (p_a, p_b)
              and (p.deleted_at is not null or p.suspended_at is not null));
$$;
revoke execute on function public.chat_unavailable(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal helper: move a chat out of "open" and update the reply rates
-- ---------------------------------------------------------------------------
-- The only place where a chat ends. It does nothing if the chat is not "open"
-- any more, so the reply rates can never be counted twice.
create function public.finish_conversation(
  p_id uuid,
  p_status public.conversation_status,
  p_reason text,
  p_closed_by uuid,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations;
  other uuid;
  opener_sent boolean;
  other_sent boolean;
begin
  select * into c from public.conversations where id = p_id for update;
  if not found or c.status <> 'open' then
    return;
  end if;

  update public.conversations
     set status = p_status,
         closed_reason = p_reason,
         closed_by = p_closed_by,
         closed_at = case when p_status in ('closed', 'expired') then p_now end
   where id = p_id;

  other := case when c.opener_id = c.user_a then c.user_b else c.user_a end;
  select exists (select 1 from public.messages m
                  where m.conversation_id = p_id and m.sender_id = c.opener_id),
         exists (select 1 from public.messages m
                  where m.conversation_id = p_id and m.sender_id = other)
    into opener_sent, other_sent;

  update public.profiles
     set reply_rate_den = reply_rate_den + 1,
         reply_rate_num = reply_rate_num + case when opener_sent then 1 else 0 end
   where id = c.opener_id;
  if opener_sent then
    update public.profiles
       set reply_rate_den = reply_rate_den + 1,
           reply_rate_num = reply_rate_num + case when other_sent then 1 else 0 end
     where id = other;
  end if;
end;
$$;
revoke execute on function public.finish_conversation(uuid, public.conversation_status, text, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5a. send_message()
-- ---------------------------------------------------------------------------
-- Returns jsonb: id, created_at, first_from_sender, first_reply.
-- Errors (raised, nothing is changed):
--   body_empty, body_too_long, body_bad_chars, conversation_not_found,
--   not_open, unavailable, window_ended, wait_for_opener, wait_for_reply,
--   rate_limited
create function public.send_message(
  p_sender uuid,
  p_conversation uuid,
  p_body text,
  p_flagged boolean default false,
  p_now timestamptz default now(),
  p_max_length integer default 1000,
  p_max_before_reply integer default 3,
  p_per_minute integer default 8,
  p_per_hour integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations;
  opener_sent integer;
  other_sent integer;
  my_sent integer;
  last_minute integer;
  last_hour integer;
  new_id uuid;
begin
  -- Input checks first. The app has already cleaned the text; these stop a
  -- direct call. Tab and newline are allowed, other control characters are not.
  if p_body is null or p_body ~ '^\s*$' then
    raise exception 'body_empty' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(p_body) > p_max_length then
    raise exception 'body_too_long' using errcode = 'invalid_parameter_value';
  end if;
  if translate(p_body, E'\n\t', '') ~ '[[:cntrl:]]' then
    raise exception 'body_bad_chars' using errcode = 'invalid_parameter_value';
  end if;

  select * into c from public.conversations where id = p_conversation for update;
  if not found or p_sender not in (c.user_a, c.user_b) then
    raise exception 'conversation_not_found' using errcode = 'no_data_found';
  end if;
  if c.status not in ('open', 'kept') then
    raise exception 'not_open' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if public.chat_unavailable(c.user_a, c.user_b) then
    raise exception 'unavailable' using errcode = 'insufficient_privilege';
  end if;

  select count(*) filter (where m.sender_id = c.opener_id),
         count(*) filter (where m.sender_id <> c.opener_id),
         count(*) filter (where m.sender_id = p_sender)
    into opener_sent, other_sent, my_sent
    from public.messages m where m.conversation_id = c.id;

  if c.status = 'open' then
    if p_now >= c.window_ends_at then
      raise exception 'window_ended' using errcode = 'object_not_in_prerequisite_state';
    end if;
    if p_sender <> c.opener_id and opener_sent = 0 then
      raise exception 'wait_for_opener' using errcode = 'object_not_in_prerequisite_state';
    end if;
    if p_sender = c.opener_id and other_sent = 0 and opener_sent >= p_max_before_reply then
      raise exception 'wait_for_reply' using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  -- Rate limit: this person's messages in the last minute / hour, over all chats.
  perform pg_advisory_xact_lock(hashtextextended('message:' || p_sender::text, 0));
  select count(*) filter (where m.created_at > p_now - interval '1 minute'),
         count(*)
    into last_minute, last_hour
    from public.messages m
   where m.sender_id = p_sender and m.created_at > p_now - interval '1 hour';
  if last_minute >= p_per_minute or last_hour >= p_per_hour then
    raise exception 'rate_limited' using errcode = 'configuration_limit_exceeded';
  end if;

  insert into public.messages (conversation_id, sender_id, body, created_at, flagged)
  values (c.id, p_sender, p_body, p_now, coalesce(p_flagged, false))
  returning id into new_id;

  return jsonb_build_object(
    'id', new_id,
    'created_at', p_now,
    'first_from_sender', my_sent = 0,
    'first_reply', my_sent = 0 and p_sender <> c.opener_id
  );
end;
$$;
revoke execute on function public.send_message(uuid, uuid, text, boolean, timestamptz, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text, boolean, timestamptz, integer, integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5b. record_decision()
-- ---------------------------------------------------------------------------
-- Returns jsonb: status = kept | closed | waiting, changed = true/false.
-- Errors: bad_decision, bad_note, conversation_not_found, not_open,
--   unavailable, window_ended, decision_not_open
create function public.record_decision(
  p_user uuid,
  p_conversation uuid,
  p_decision text,
  p_note text default null,
  p_now timestamptz default now(),
  p_decision_after_hours integer default 48
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  c public.conversations;
  opener_sent integer;
  other_sent integer;
  mine public.decision;
  theirs public.decision;
  is_a boolean;
begin
  if p_decision not in ('keep', 'close') then
    raise exception 'bad_decision' using errcode = 'invalid_parameter_value';
  end if;
  if v_note is not null and (char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]') then
    raise exception 'bad_note' using errcode = 'invalid_parameter_value';
  end if;

  select * into c from public.conversations where id = p_conversation for update;
  if not found or p_user not in (c.user_a, c.user_b) then
    raise exception 'conversation_not_found' using errcode = 'no_data_found';
  end if;
  if c.status <> 'open' then
    raise exception 'not_open' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if public.chat_unavailable(c.user_a, c.user_b) then
    raise exception 'unavailable' using errcode = 'insufficient_privilege';
  end if;
  if p_now >= c.window_ends_at then
    raise exception 'window_ended' using errcode = 'object_not_in_prerequisite_state';
  end if;

  select count(*) filter (where m.sender_id = c.opener_id),
         count(*) filter (where m.sender_id <> c.opener_id)
    into opener_sent, other_sent
    from public.messages m where m.conversation_id = c.id;
  if opener_sent = 0 or other_sent = 0
     or p_now < c.opened_at + make_interval(hours => p_decision_after_hours) then
    raise exception 'decision_not_open' using errcode = 'object_not_in_prerequisite_state';
  end if;

  is_a := (p_user = c.user_a);
  mine := case when is_a then c.a_decision else c.b_decision end;
  theirs := case when is_a then c.b_decision else c.a_decision end;

  if p_decision = 'close' then
    update public.conversations
       set a_decision = case when is_a then 'close' else a_decision end,
           b_decision = case when is_a then b_decision else 'close' end
     where id = c.id;
    perform public.finish_conversation(c.id, 'closed', v_note, p_user, p_now);
    return jsonb_build_object('status', 'closed', 'changed', true);
  end if;

  -- keep
  if mine = 'keep' then
    return jsonb_build_object('status', 'waiting', 'changed', false);
  end if;
  update public.conversations
     set a_decision = case when is_a then 'keep' else a_decision end,
         b_decision = case when is_a then b_decision else 'keep' end
   where id = c.id;
  if theirs = 'keep' then
    perform public.finish_conversation(c.id, 'kept', null, null, p_now);
    return jsonb_build_object('status', 'kept', 'changed', true);
  end if;
  return jsonb_build_object('status', 'waiting', 'changed', true);
end;
$$;
revoke execute on function public.record_decision(uuid, uuid, text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.record_decision(uuid, uuid, text, text, timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5c. expire_conversations(): the hourly job
-- ---------------------------------------------------------------------------
-- Ends every open chat whose window is over. Safe to run twice: a chat that
-- is already expired is not "open", so the second run finds nothing. Returns
-- counts and the ids of the people whose slot was freed (the app uses them
-- to retry matches that were waiting for a slot). No message text.
create function public.expire_conversations(
  p_now timestamptz default now(),
  p_batch integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  opener_sent integer;
  other_sent integer;
  reason text;
  n integer := 0;
  n_first integer := 0;
  n_reply integer := 0;
  n_decision integer := 0;
  people uuid[] := '{}';
begin
  for c in
    select id, user_a, user_b, opener_id from public.conversations
     where status = 'open' and window_ends_at <= p_now
     order by window_ends_at
     limit p_batch
     for update skip locked
  loop
    select count(*) filter (where m.sender_id = c.opener_id),
           count(*) filter (where m.sender_id <> c.opener_id)
      into opener_sent, other_sent
      from public.messages m where m.conversation_id = c.id;

    if opener_sent = 0 then
      reason := 'No first message within the window.';
      n_first := n_first + 1;
    elsif other_sent = 0 then
      reason := 'No reply within the window.';
      n_reply := n_reply + 1;
    else
      reason := 'No decision within the window.';
      n_decision := n_decision + 1;
    end if;

    perform public.finish_conversation(c.id, 'expired', reason, null, p_now);
    people := people || c.user_a || c.user_b;
    n := n + 1;
  end loop;

  return jsonb_build_object(
    'expired', n,
    'no_first_message', n_first,
    'no_reply', n_reply,
    'no_decision', n_decision,
    'user_ids', coalesce((select jsonb_agg(distinct u) from unnest(people) as u), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.expire_conversations(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.expire_conversations(timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6a. get_conversation(): one chat, as the signed-in person sees it
-- ---------------------------------------------------------------------------
-- Returns null for anyone who is not in the chat (the page then shows a 404).
-- Includes YOUR decision but never the other person's. "unavailable" is true
-- when a block, suspension or deletion stops the chat, without saying why.
create function public.get_conversation(p_conversation uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.conversations;
  i_sent integer;
  they_sent integer;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.conversations where id = p_conversation;
  if not found or me not in (c.user_a, c.user_b) then
    return null;
  end if;

  select count(*) filter (where m.sender_id = me),
         count(*) filter (where m.sender_id <> me)
    into i_sent, they_sent
    from public.messages m where m.conversation_id = c.id;

  return jsonb_build_object(
    'id', c.id,
    'user_a', c.user_a,
    'user_b', c.user_b,
    'other_id', case when me = c.user_a then c.user_b else c.user_a end,
    'opener_id', c.opener_id,
    'status', c.status,
    'opened_at', c.opened_at,
    'window_ends_at', c.window_ends_at,
    'closed_reason', c.closed_reason,
    'closed_by', c.closed_by,
    'my_decision', case when me = c.user_a then c.a_decision else c.b_decision end,
    'i_sent', i_sent,
    'they_sent', they_sent,
    'unavailable', public.chat_unavailable(c.user_a, c.user_b),
    'server_now', clock_timestamp()
  );
end;
$$;
revoke execute on function public.get_conversation(uuid) from public, anon;
grant execute on function public.get_conversation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6b. my_conversation_summaries(): the list screen
-- ---------------------------------------------------------------------------
-- "security invoker": it runs with the caller's own rights, so the same row
-- level security as everywhere else decides what comes back. (Ended chats
-- return no preview because their messages are not readable.)
create function public.my_conversation_summaries()
returns table (
  conversation_id uuid,
  last_body text,
  last_sender uuid,
  last_at timestamptz,
  unread integer,
  i_sent integer,
  they_sent integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         left(lm.body, 200),
         lm.sender_id,
         lm.created_at,
         (select count(*)::integer from public.messages m
           where m.conversation_id = c.id
             and m.sender_id <> auth.uid()
             and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
         (select count(*)::integer from public.messages m
           where m.conversation_id = c.id and m.sender_id = auth.uid()),
         (select count(*)::integer from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid())
    from public.conversations c
    left join public.conversation_reads r
      on r.conversation_id = c.id and r.user_id = auth.uid()
    left join lateral (
      select m2.body, m2.sender_id, m2.created_at
        from public.messages m2
       where m2.conversation_id = c.id
       order by m2.created_at desc, m2.id desc
       limit 1
    ) lm on true
   where auth.uid() in (c.user_a, c.user_b);
$$;
revoke execute on function public.my_conversation_summaries() from public, anon;
grant execute on function public.my_conversation_summaries() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6c. mark_conversation_read(): "I have seen everything up to now"
-- ---------------------------------------------------------------------------
create function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.conversations c
     where c.id = p_conversation and me in (c.user_a, c.user_b)
  ) then
    raise exception 'conversation_not_found' using errcode = 'no_data_found';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation, me, clock_timestamp())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------------
-- Supabase Realtime sends a row change only to people whose own "select"
-- policy lets them read that row, so the existing messages policy
-- (participants of an open or kept chat) is what keeps strangers out. The
-- table has to be in the "supabase_realtime" publication. Inserts need no
-- special replica identity (the default sends the new row). The block is
-- skipped where that publication does not exist (a plain Postgres).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when duplicate_object then
  null;  -- already added
end;
$$;
