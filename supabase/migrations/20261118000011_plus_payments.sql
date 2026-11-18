-- Shortlist: Plus and payments.
--
-- What this adds (the earlier migrations are already applied, so this is a new
-- file and changes nothing that was there except as stated):
--
--   1. Extra columns on orders (currency, provider, days, paid_at, granted_until,
--      failure_reason, revoked_at) and an admin read policy. Users still can
--      only READ their own orders; nobody but the server writes them.
--   2. grant_plus(): the ONE place a payment turns into Plus. Both the browser
--      callback and the webhook call it. It locks the order row, marks it paid
--      exactly once, adds the days to plus_until and writes an event. Calling it
--      again with the same order changes nothing and answers "already_granted".
--   3. fail_order(): marks a created order failed (a failed attempt can still be
--      followed by a successful one, which grant_plus accepts).
--   4. revoke_plus(): an admin takes Plus away (audit logged). No refund is made
--      here; refunds are handled by hand in the payment provider's dashboard.
--   5. grant_demo_plus(): a demo helper for demo accounts. The server decides who
--      may use it (DEMO_CONTROLS and the demo flag); this only does the maths.
--   6. "Second look" for Plus members: intros.revived_until, profiles.
--      second_look_used_at, use_second_look(), my_second_looks(), and
--      decide_intro() (same function as before, one change: an intro that was
--      brought back stays answerable until revived_until).
--
-- All of the functions below are SECURITY DEFINER. Everything that changes money
-- or entitlement has EXECUTE for service_role only, so a signed-in user cannot
-- call it from the browser; only our server can, after its own checks.

-- ---------------------------------------------------------------------------
-- 1. orders
-- ---------------------------------------------------------------------------
alter table public.orders
  add column currency text not null default 'INR',
  add column provider text not null default 'razorpay'
    check (provider in ('razorpay', 'simulated')),
  add column days integer check (days > 0),
  add column paid_at timestamptz,
  add column granted_until timestamptz,
  add column failure_reason text check (char_length(failure_reason) <= 200),
  add column revoked_at timestamptz;

-- A paid order always says which payment paid it.
alter table public.orders
  add constraint orders_paid_has_payment
  check (status <> 'paid' or razorpay_payment_id is not null);

create policy orders_select_admin on public.orders
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. plus_extend(): add days to someone's Plus (internal helper)
-- ---------------------------------------------------------------------------
-- New time is added to the END of the Plus the person still has, or to "now"
-- if it has run out, so buying early never wastes days.
create function public.plus_extend(p_user uuid, p_days integer, p_now timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  current_until timestamptz;
  new_until timestamptz;
begin
  if p_days is null or p_days <= 0 then
    raise exception 'bad_days' using errcode = 'invalid_parameter_value';
  end if;
  select plus_until into current_until
    from public.profiles where id = p_user for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'no_data_found';
  end if;
  new_until := greatest(p_now, coalesce(current_until, p_now)) + make_interval(days => p_days);
  update public.profiles set plus_until = new_until where id = p_user;
  return new_until;
end;
$$;

-- Internal: only other functions in this file call it.
revoke execute on function public.plus_extend(uuid, integer, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. grant_plus(): a verified payment becomes Plus, exactly once
-- ---------------------------------------------------------------------------
-- The caller (our server) has ALREADY checked the provider's signature. This
-- function does not trust the caller about anything else: it looks the order up,
-- locks it, and checks who it belongs to and what it cost.
--
-- Answers (never an error for these, so a repeated webhook is just a no-op):
--   granted            Plus was added now
--   already_granted    this order was paid before; nothing changed
--   not_found          no such order (for example someone else's payment)
--   wrong_user         the order belongs to another member
--   amount_mismatch    the paid amount is not the order amount
--   currency_mismatch  the paid currency is not the order currency
--   payment_conflict   that payment id is already used by another order
--   order_orphaned     the member who owned the order no longer exists
create function public.grant_plus(
  p_provider_order_id text,
  p_payment_id text,
  p_amount_paise integer default null,
  p_currency text default null,
  p_expected_user uuid default null,
  p_source text default 'callback',
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  new_until timestamptz;
  plan_days integer;
begin
  if p_source not in ('callback', 'webhook') then
    raise exception 'bad_source' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(btrim(p_payment_id), '') = '' or coalesce(btrim(p_provider_order_id), '') = '' then
    raise exception 'bad_ids' using errcode = 'invalid_parameter_value';
  end if;

  -- The lock: a second call for the same order waits here until the first
  -- one has finished, then sees status = 'paid'.
  select * into o from public.orders
   where razorpay_order_id = p_provider_order_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if o.user_id is null then
    return jsonb_build_object('result', 'order_orphaned');
  end if;
  if p_expected_user is not null and o.user_id <> p_expected_user then
    return jsonb_build_object('result', 'wrong_user');
  end if;
  if p_amount_paise is not null and p_amount_paise <> o.amount_paise then
    return jsonb_build_object('result', 'amount_mismatch');
  end if;
  if p_currency is not null and upper(p_currency) <> o.currency then
    return jsonb_build_object('result', 'currency_mismatch');
  end if;

  if o.status = 'paid' then
    return jsonb_build_object(
      'result', 'already_granted',
      'same_payment', o.razorpay_payment_id = p_payment_id,
      'plus_until', o.granted_until);
  end if;

  begin
    update public.orders
       set status = 'paid', razorpay_payment_id = p_payment_id,
           paid_at = p_now, failure_reason = null
     where id = o.id;
  exception when unique_violation then
    return jsonb_build_object('result', 'payment_conflict');
  end;

  plan_days := coalesce(o.days, case o.plan when 'plus_1m' then 30 else 90 end);
  new_until := public.plus_extend(o.user_id, plan_days, p_now);
  update public.orders set granted_until = new_until where id = o.id;

  insert into public.events (user_id, name, props, at)
  values (o.user_id, 'plus_granted',
          jsonb_build_object('plan', o.plan, 'source', p_source,
                             'provider', o.provider, 'amount_paise', o.amount_paise),
          p_now);

  return jsonb_build_object('result', 'granted', 'plus_until', new_until);
end;
$$;

revoke execute on function public.grant_plus(text, text, integer, text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grant_plus(text, text, integer, text, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. fail_order(): a payment attempt failed
-- ---------------------------------------------------------------------------
-- Only an order that is still "created" can fail, and a failed order can still
-- be paid later (the member may try another card on the same order), so this
-- never undoes a paid order.
create function public.fail_order(
  p_provider_order_id text,
  p_expected_user uuid,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.orders
     set status = 'failed', failure_reason = left(p_reason, 200)
   where razorpay_order_id = p_provider_order_id
     and status = 'created'
     and (p_expected_user is null or user_id = p_expected_user);
  get diagnostics changed = row_count;
  return case when changed > 0 then 'failed' else 'unchanged' end;
end;
$$;

revoke execute on function public.fail_order(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_order(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. revoke_plus(): an admin ends someone's Plus (audit logged, no refund call)
-- ---------------------------------------------------------------------------
create function public.revoke_plus(
  p_admin uuid,
  p_target uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous timestamptz;
begin
  if not exists (
    select 1 from public.profiles
     where id = p_admin and role = 'admin'
       and suspended_at is null and deleted_at is null
  ) then
    raise exception 'not_admin' using errcode = 'insufficient_privilege';
  end if;

  select plus_until into previous from public.profiles where id = p_target for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'no_data_found';
  end if;
  if previous is null or previous <= p_now then
    raise exception 'not_plus' using errcode = 'no_data_found';
  end if;

  update public.profiles set plus_until = p_now where id = p_target;
  update public.orders set revoked_at = p_now
   where user_id = p_target and status = 'paid' and revoked_at is null;

  insert into public.audit_log (admin_id, action, target, at)
  values (p_admin, 'plus_revoked', 'profile:' || p_target::text, p_now);

  return jsonb_build_object('result', 'revoked', 'previous_plus_until', previous);
end;
$$;

revoke execute on function public.revoke_plus(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.revoke_plus(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6. grant_demo_plus(): free Plus for demo accounts (the server checks who)
-- ---------------------------------------------------------------------------
create function public.grant_demo_plus(
  p_user uuid,
  p_days integer,
  p_now timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  new_until timestamptz;
begin
  new_until := public.plus_extend(p_user, p_days, p_now);
  insert into public.events (user_id, name, props, at)
  values (p_user, 'plus_demo_granted', jsonb_build_object('days', p_days), p_now);
  return new_until;
end;
$$;

revoke execute on function public.grant_demo_plus(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.grant_demo_plus(uuid, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Second look (a Plus perk)
-- ---------------------------------------------------------------------------
-- Once every 30 days a Plus member can bring back ONE intro from the last four
-- weeks that they passed on or let expire. It becomes answerable again for 72
-- hours (revived_until). Nothing is shown to the other person. If they had said
-- Interested in that same drop, answering Interested now opens the chat the
-- usual way (same caps, same woman-first rule); otherwise it is saved quietly,
-- exactly like any other Interested.
alter table public.intros add column revived_until timestamptz;
alter table public.profiles add column second_look_used_at timestamptz;

create function public.use_second_look(
  p_user uuid,
  p_intro uuid,
  p_now timestamptz default now(),
  p_per_days integer default 30,
  p_lookback_days integer default 28,
  p_revived_hours integer default 72,
  p_expiry_minutes integer default 9510
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  candidate uuid;
  mine public.intros;
  me public.profiles;
  week date;
  expires timestamptz;
  revived_end timestamptz := p_now + make_interval(hours => p_revived_hours);
begin
  select viewer_id, candidate_id into owner, candidate
    from public.intros where id = p_intro;
  if not found or owner <> p_user then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- The same two locks decide_intro() takes, so the two cannot run at once
  -- on the same pair.
  perform pg_advisory_xact_lock(hashtextextended('shortlist:' || least(p_user::text, candidate::text), 0));
  perform pg_advisory_xact_lock(hashtextextended('shortlist:' || greatest(p_user::text, candidate::text), 0));

  select * into me from public.profiles where id = p_user for update;
  if not found or me.deleted_at is not null or me.suspended_at is not null or me.paused then
    return jsonb_build_object('result', 'unavailable');
  end if;
  if me.plus_until is null or me.plus_until <= p_now then
    return jsonb_build_object('result', 'not_plus');
  end if;
  if me.second_look_used_at is not null
     and me.second_look_used_at > p_now - make_interval(days => p_per_days) then
    return jsonb_build_object(
      'result', 'used_recently',
      'available_at', me.second_look_used_at + make_interval(days => p_per_days));
  end if;

  select * into mine from public.intros where id = p_intro for update;
  select d.week_start into week from public.drops d where d.id = mine.drop_id;
  expires := (week::timestamp at time zone 'UTC') + make_interval(mins => p_expiry_minutes);

  if (week::timestamp at time zone 'UTC') < p_now - make_interval(days => p_lookback_days) then
    return jsonb_build_object('result', 'too_old');
  end if;
  if mine.revived_until is not null and mine.revived_until > p_now then
    return jsonb_build_object('result', 'already_revived');
  end if;
  -- Only an intro that was passed on, or that was never answered and is over.
  if not (mine.status = 'passed'
          or mine.status = 'expired'
          or (mine.status = 'new' and p_now >= expires)) then
    return jsonb_build_object('result', 'not_eligible');
  end if;

  if exists (
       select 1 from public.blocks b
        where (b.blocker_id = p_user and b.blocked_id = candidate)
           or (b.blocker_id = candidate and b.blocked_id = p_user)
     )
     or not exists (
       select 1 from public.profiles c
        where c.id = candidate and c.deleted_at is null
          and c.suspended_at is null and not c.paused
     )
     or exists (
       select 1 from public.conversations c
        where c.status in ('open', 'kept')
          and least(c.user_a, c.user_b) = least(p_user, candidate)
          and greatest(c.user_a, c.user_b) = greatest(p_user, candidate)
     ) then
    return jsonb_build_object('result', 'unavailable');
  end if;

  update public.intros
     set status = 'new', decided_at = null, note = null, revived_until = revived_end
   where id = p_intro;
  update public.profiles set second_look_used_at = p_now where id = p_user;
  insert into public.events (user_id, name, props, at)
  values (p_user, 'second_look_used', '{}', p_now);

  return jsonb_build_object('result', 'revived', 'revived_until', revived_end);
end;
$$;

revoke execute on function public.use_second_look(uuid, uuid, timestamptz, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.use_second_look(uuid, uuid, timestamptz, integer, integer, integer, integer)
  to service_role;

-- What the second look section of /shortlist shows, for the signed-in member:
-- when they last used it, the intros they could bring back, and the ones that
-- are back right now. Only the caller's own intros are ever returned.
create function public.my_second_looks(
  p_lookback_days integer default 28,
  p_expiry_minutes integer default 9510
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  used timestamptz;
  eligible jsonb;
  revived jsonb;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'insufficient_privilege';
  end if;
  select second_look_used_at into used from public.profiles where id = me;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'candidate_id', x.candidate_id,
           'week_start', x.week_start, 'status', x.status
         ) order by x.week_start desc, x.score desc), '[]'::jsonb)
    into eligible
    from (
      select i.id, i.candidate_id, d.week_start, i.status, i.score
        from public.intros i
        join public.drops d on d.id = i.drop_id
        join public.profiles c on c.id = i.candidate_id
       where i.viewer_id = me
         and (d.week_start::timestamp at time zone 'UTC') >= now() - make_interval(days => p_lookback_days)
         and (i.revived_until is null or i.revived_until <= now())
         and (i.status in ('passed', 'expired')
              or (i.status = 'new'
                  and now() >= (d.week_start::timestamp at time zone 'UTC') + make_interval(mins => p_expiry_minutes)))
         and c.deleted_at is null and c.suspended_at is null and not c.paused
         and not exists (
           select 1 from public.blocks b
            where (b.blocker_id = me and b.blocked_id = i.candidate_id)
               or (b.blocker_id = i.candidate_id and b.blocked_id = me))
         and not exists (
           select 1 from public.conversations v
            where v.status in ('open', 'kept')
              and least(v.user_a, v.user_b) = least(me, i.candidate_id)
              and greatest(v.user_a, v.user_b) = greatest(me, i.candidate_id))
       order by d.week_start desc, i.score desc
       limit 10
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'candidate_id', i.candidate_id, 'reasons', i.reasons,
           'status', i.status, 'note', i.note, 'revived_until', i.revived_until
         ) order by i.revived_until), '[]'::jsonb)
    into revived
    from public.intros i
   where i.viewer_id = me and i.revived_until > now();

  return jsonb_build_object('used_at', used, 'eligible', eligible, 'revived', revived);
end;
$$;

revoke execute on function public.my_second_looks(integer, integer) from public, anon;
grant execute on function public.my_second_looks(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. decide_intro(), one change
-- ---------------------------------------------------------------------------
-- Identical to the version in 20261118000009, except that a brought-back intro
-- (revived_until set and in the future) stays answerable past its week's end:
-- the line that works out "expires" now takes the later of the two times.

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
  expires := greatest(
    (week::timestamp at time zone 'UTC') + make_interval(mins => p_expiry_minutes),
    coalesce(mine.revived_until, '-infinity'::timestamptz));
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
