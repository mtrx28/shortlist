-- Shortlist: stop a finished chat from being opened again.
--
-- Found by the browser tests: when a chat ended (closed kindly, ended after
-- keep, or expired) its slot was freed and the app retried every waiting
-- "Interested". Both people's intros in that drop were still "interested", so
-- decide_intro() opened a SECOND chat with the same person straight away, and
-- again after each expiry. The documented rule is one chat per mutual
-- interest in a drop. decide_intro() now answers "already_chatted" (a neutral
-- "interest saved", the same words as "waiting") when a conversation already
-- came from either of the two intros. Nothing else in the function changed.
-- (The earlier migrations are already applied, so this is a new file.)

create or replace function public.decide_intro(
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

  -- A chat already opened from this very pair of intros and has since ended
  -- (closed, expired, blocked): one chat per mutual interest. Without this,
  -- freeing a slot made the retry open a brand new chat with the same person.
  if exists (
    select 1 from public.conversations c
     where c.origin_intro_a in (mine.id, theirs.id)
        or c.origin_intro_b in (mine.id, theirs.id)
  ) then
    return jsonb_build_object('status', 'interest_saved', 'reason', 'already_chatted');
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
