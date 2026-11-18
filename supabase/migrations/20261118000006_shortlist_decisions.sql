-- Shortlist: answering an intro (Interested / Pass) and opening a chat.
--
-- The screen where members answer their weekly intros needs the database to
-- do three things safely: record the answer, notice when two people are
-- interested in each other, and open exactly one chat for them while keeping
-- to the rules (woman opens in man-woman pairs, a cap on open chats). A
-- browser or a server action doing this in several separate calls could be
-- raced, so it is done inside the database, in one transaction.
--
-- The earlier migrations are already applied, so everything new is here.
--
-- What is added:
--   1. intros.decided_at and intros.viewed_at (when you answered / first saw it).
--   2. my_shortlist()            what /shortlist reads (your own intros only).
--   3. conversation_intro_notes() the notes two chatters wrote on their intros.
--   4. decide_intro()            the answer itself (server only).
--
-- The rules, in plain words (the TypeScript twin is lib/shortlist/decide.ts and
-- a test runs the same cases through both):
--   * Only the owner of a "new", not-yet-expired intro can answer it. The same
--     error is used for "not yours" and "does not exist", so ids cannot be probed.
--   * A pass is silent: the other person is never told and never sees a trace.
--   * "Interested" is saved. A chat opens only when BOTH people are interested
--     in each other in the same drop. So a man's interest alone never opens a
--     chat, and neither does a woman's: it waits for the other side.
--   * In a man-woman pair the woman is the opener (she writes first). In any
--     other pair (two women, two men, or anyone with a non-binary person)
--     there is no woman-first rule: plain mutual interest opens the chat and
--     whoever showed interest first opens it. Configurable with p_woman_opens.
--   * Cap: nobody can have more than 3 open chats (5 with Plus). If YOU are at
--     your cap you cannot say Interested (nothing is saved; you can still
--     Pass). If the OTHER person is at their cap, your interest is saved and
--     the chat opens later, the next time either of you is under the cap and
--     the answer is repeated (the app repeats it when you open Shortlist or
--     Chats). The message to you is the same neutral one as "waiting", so it
--     never reveals what the other person decided.
--
-- Concurrency: two double-clicks, or both people answering at the same moment,
-- are serialised with advisory locks, one per person, always taken in the same
-- order (so two calls cannot wait on each other forever). Because the lock is
-- per person, two chats being opened for the same person at once cannot both
-- slip under the cap either. The unique "one live chat per pair" index from
-- the first migration is the final backstop.

-- ---------------------------------------------------------------------------
-- 1. Two timestamps on intros
-- ---------------------------------------------------------------------------
alter table public.intros
  add column decided_at timestamptz,
  add column viewed_at timestamptz;

-- Intros that were answered before this column existed (the demo data).
update public.intros
   set decided_at = created_at
 where status in ('passed', 'interested') and decided_at is null;

-- Users read their own intros through the existing select policy and grant, so
-- the new columns follow the same rule (viewer_id = you). Nobody gets a write
-- grant: answers go through decide_intro() below.

-- ---------------------------------------------------------------------------
-- 2. my_shortlist(): what the Shortlist screen shows
-- ---------------------------------------------------------------------------
-- Returns the intros of the signed-in user for the latest drop, and the week
-- that drop belongs to (users cannot read the drops table, which also holds
-- admin statistics). The score is not returned. First views are stamped here
-- so the app can log "intro_viewed" once per intro; that is why this function
-- is not read-only.
-- "security definer" lets it read drops; it only ever returns rows where
-- viewer_id is the caller, so it never shows anybody else's intro.
create function public.my_shortlist()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  latest_drop uuid;
  latest_week date;
  fresh uuid[];
  items jsonb;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'insufficient_privilege';
  end if;

  select id, week_start into latest_drop, latest_week
    from public.drops order by week_start desc limit 1;
  if latest_drop is null then
    return jsonb_build_object('week_start', null, 'intros', '[]'::jsonb);
  end if;

  with touched as (
    update public.intros
       set viewed_at = now()
     where drop_id = latest_drop and viewer_id = me and viewed_at is null
    returning id
  )
  select coalesce(array_agg(id), '{}') into fresh from touched;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', i.id,
             'candidate_id', i.candidate_id,
             'reasons', i.reasons,
             'status', i.status,
             'note', i.note,
             'first_view', i.id = any (fresh)
           ) order by i.score desc, i.id), '[]'::jsonb)
    into items
    from public.intros i
   where i.drop_id = latest_drop and i.viewer_id = me;

  return jsonb_build_object('week_start', latest_week, 'intros', items);
end;
$$;

revoke execute on function public.my_shortlist() from public, anon;
grant execute on function public.my_shortlist() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. conversation_intro_notes(): the short notes written with "Interested"
-- ---------------------------------------------------------------------------
-- A note is private to its author until a chat exists. Then both people in
-- that chat may read the two notes. This returns them, for participants only.
create function public.conversation_intro_notes(p_conversation uuid)
returns table (author_id uuid, note text)
language sql
stable
security definer
set search_path = public
as $$
  select i.viewer_id, i.note
    from public.conversations c
    join public.intros i on i.id in (c.origin_intro_a, c.origin_intro_b)
   where c.id = p_conversation
     and auth.uid() in (c.user_a, c.user_b)
     and i.note is not null;
$$;

revoke execute on function public.conversation_intro_notes(uuid) from public, anon;
grant execute on function public.conversation_intro_notes(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. decide_intro(): answer one intro
-- ---------------------------------------------------------------------------
-- Why service_role only (and not "authenticated with auth.uid()"): the caps,
-- the 72 hour window and the expiry time come from config/shortlist.ts and are
-- passed in as parameters. If a signed-in user could call this directly they
-- could pass a cap of 1000. Only our server can call it, and the server takes
-- p_viewer from the verified session, never from the request body. The
-- function still checks that the intro belongs to p_viewer, so a bug in the
-- server cannot answer someone else's intro either.
--
-- Returns jsonb:
--   status  passed | interest_saved | opened | already_open | viewer_at_cap
--   reason  (interest_saved only) waiting | other_at_cap | unavailable
--   conversation_id, opener_id   (opened / already_open)
-- Errors (raised, nothing is changed):
--   bad_decision, bad_note, intro_not_found, viewer_unavailable,
--   intro_expired, already_decided
create function public.decide_intro(
  p_viewer uuid,
  p_intro uuid,
  p_decision text,
  p_note text default null,
  p_now timestamptz default now(),
  p_free_cap integer default 3,
  p_plus_cap integer default 5,
  p_window_hours integer default 72,
  p_expiry_minutes integer default 9510,
  p_woman_opens boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  candidate uuid;
  owner uuid;
  mine public.intros;
  theirs public.intros;
  me public.profiles;
  them public.profiles;
  week date;
  expires timestamptz;
  my_chats integer;
  their_chats integer;
  my_cap integer;
  their_cap integer;
  live record;
  opener uuid;
  new_id uuid;
begin
  -- Input checks. The app has already cleaned the note; these stop a direct call.
  if p_decision not in ('interested', 'passed') then
    raise exception 'bad_decision' using errcode = 'invalid_parameter_value';
  end if;
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[[:cntrl:]]') then
    raise exception 'bad_note' using errcode = 'invalid_parameter_value';
  end if;

  -- Whose intro is this, and who is it about? (Read without a lock, only to
  -- learn which two people to lock.) Same error for "not yours" and "missing".
  select viewer_id, candidate_id into owner, candidate
    from public.intros where id = p_intro;
  if not found or owner <> p_viewer then
    raise exception 'intro_not_found' using errcode = 'no_data_found';
  end if;

  -- One lock per person, smaller id first, so two calls always queue in the same order.
  perform pg_advisory_xact_lock(hashtextextended('shortlist:' || least(p_viewer::text, candidate::text), 0));
  perform pg_advisory_xact_lock(hashtextextended('shortlist:' || greatest(p_viewer::text, candidate::text), 0));

  -- Re-read the intro now that we hold the locks (it may have just changed).
  select * into mine from public.intros where id = p_intro for update;

  select * into me from public.profiles where id = p_viewer;
  if not found or me.deleted_at is not null or me.suspended_at is not null
     or me.paused or me.onboarding_completed_at is null then
    raise exception 'viewer_unavailable' using errcode = 'insufficient_privilege';
  end if;

  select d.week_start into week from public.drops d where d.id = mine.drop_id;
  expires := (week::timestamp at time zone 'UTC') + make_interval(mins => p_expiry_minutes);
  if mine.status = 'expired' or p_now >= expires then
    raise exception 'intro_expired' using errcode = 'invalid_parameter_value';
  end if;

  -- ---- Pass: silent, and a repeat is a no-op ----
  if p_decision = 'passed' then
    if mine.status = 'interested' then
      raise exception 'already_decided' using errcode = 'invalid_parameter_value';
    end if;
    if mine.status = 'new' then
      update public.intros
         set status = 'passed', decided_at = p_now, note = null
       where id = mine.id;
    end if;
    return jsonb_build_object('status', 'passed');
  end if;

  -- ---- Interested ----
  if mine.status = 'passed' then
    raise exception 'already_decided' using errcode = 'invalid_parameter_value';
  end if;

  my_cap := case when me.plus_until is not null and me.plus_until > p_now
                 then p_plus_cap else p_free_cap end;
  select count(*) into my_chats from public.conversations c
   where c.status in ('open', 'kept') and p_viewer in (c.user_a, c.user_b);

  if mine.status = 'new' then
    -- At your cap you cannot say Interested yet. Nothing is saved, so this
    -- also reveals nothing about the other person.
    if my_chats >= my_cap then
      return jsonb_build_object('status', 'viewer_at_cap');
    end if;
    update public.intros
       set status = 'interested', decided_at = p_now, note = v_note
     where id = mine.id;
    mine.status := 'interested';
    mine.decided_at := p_now;
  end if;
  -- (status was already 'interested': a repeated click. We fall through and
  -- try to open the chat again, which is how a waiting match gets a retry.)

  -- Is the other person interested in me, in the same drop?
  select * into theirs from public.intros
   where drop_id = mine.drop_id and viewer_id = candidate and candidate_id = p_viewer
   for update;
  if not found or theirs.status <> 'interested' then
    return jsonb_build_object('status', 'interest_saved', 'reason', 'waiting');
  end if;

  select * into them from public.profiles where id = candidate;
  if not found or them.deleted_at is not null or them.suspended_at is not null
     or them.paused or them.onboarding_completed_at is null
     or exists (
       select 1 from public.blocks b
        where (b.blocker_id = p_viewer and b.blocked_id = candidate)
           or (b.blocker_id = candidate and b.blocked_id = p_viewer)
     ) then
    return jsonb_build_object('status', 'interest_saved', 'reason', 'unavailable');
  end if;

  -- Already chatting (a double click, or a retry after the chat opened)?
  select c.id, c.opener_id into live from public.conversations c
   where c.status in ('open', 'kept')
     and least(c.user_a, c.user_b) = least(p_viewer, candidate)
     and greatest(c.user_a, c.user_b) = greatest(p_viewer, candidate);
  if found then
    return jsonb_build_object('status', 'already_open',
                              'conversation_id', live.id, 'opener_id', live.opener_id);
  end if;

  -- Caps, for both people.
  if my_chats >= my_cap then
    return jsonb_build_object('status', 'viewer_at_cap');
  end if;
  their_cap := case when them.plus_until is not null and them.plus_until > p_now
                    then p_plus_cap else p_free_cap end;
  select count(*) into their_chats from public.conversations c
   where c.status in ('open', 'kept') and candidate in (c.user_a, c.user_b);
  if their_chats >= their_cap then
    return jsonb_build_object('status', 'interest_saved', 'reason', 'other_at_cap');
  end if;

  -- Who writes first. Man + woman: the woman. Anyone else: whoever said
  -- Interested first (ties go to the smaller id so the result is stable).
  if p_woman_opens and me.gender = 'woman' and them.gender = 'man' then
    opener := p_viewer;
  elsif p_woman_opens and me.gender = 'man' and them.gender = 'woman' then
    opener := candidate;
  elsif coalesce(mine.decided_at, mine.created_at) < coalesce(theirs.decided_at, theirs.created_at) then
    opener := p_viewer;
  elsif coalesce(mine.decided_at, mine.created_at) > coalesce(theirs.decided_at, theirs.created_at) then
    opener := candidate;
  else
    opener := least(p_viewer, candidate);
  end if;

  begin
    insert into public.conversations
      (user_a, user_b, opener_id, origin_intro_a, origin_intro_b, status, opened_at, window_ends_at)
    values
      (p_viewer, candidate, opener, mine.id, theirs.id, 'open', p_now,
       p_now + make_interval(hours => p_window_hours))
    returning id into new_id;
  exception when unique_violation then
    -- Backstop: the unique index caught a second live chat for this pair.
    select c.id, c.opener_id into live from public.conversations c
     where c.status in ('open', 'kept')
       and least(c.user_a, c.user_b) = least(p_viewer, candidate)
       and greatest(c.user_a, c.user_b) = greatest(p_viewer, candidate);
    return jsonb_build_object('status', 'already_open',
                              'conversation_id', live.id, 'opener_id', live.opener_id);
  end;

  return jsonb_build_object('status', 'opened', 'conversation_id', new_id, 'opener_id', opener);
end;
$$;

revoke execute on function public.decide_intro(uuid, uuid, text, text, timestamptz, integer, integer, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.decide_intro(uuid, uuid, text, text, timestamptz, integer, integer, integer, integer, boolean)
  to service_role;
