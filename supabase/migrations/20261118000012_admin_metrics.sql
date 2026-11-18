-- Shortlist: one read-only function that returns the numbers for the admin
-- dashboard cards. It returns counts and sums only, never a row about a person.
--
-- Why a function and not several selects from the page: conversations hide the
-- two people's Keep/Close choices from every API role (so nobody can see what
-- the other chose), and an admin should not get a way around that just to draw
-- a chart. The function runs with its owner's rights, checks the caller is an
-- active admin itself, and gives back totals.
create function public.admin_metrics(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'members', (select count(*) from public.profiles
                 where onboarding_completed_at is not null and deleted_at is null),
    'verified', (select count(*) from public.profiles
                  where elitmus_status = 'verified' and deleted_at is null),
    'active_chats', (select count(*) from public.conversations
                      where status in ('open', 'kept')),
    'intros_delivered', (select count(*) from public.intros),
    -- Reply rate: of the replies that were owed in chats that have finished
    -- their first 72 hours, how many were sent. The counters are kept by the
    -- chat functions (see the conversations migration).
    'replies_owed', (select coalesce(sum(reply_rate_den), 0) from public.profiles),
    'replies_sent', (select coalesce(sum(reply_rate_num), 0) from public.profiles),
    'kept_chats', (select count(*) from public.conversations where status = 'kept'),
    'closed_chats', (select count(*) from public.conversations where status = 'closed'),
    'expired_chats', (select count(*) from public.conversations where status = 'expired'),
    'plus_members', (select count(*) from public.profiles
                      where plus_until > p_now and deleted_at is null),
    'paid_orders', (select count(*) from public.orders where status = 'paid'),
    'revenue_paise', (select coalesce(sum(amount_paise), 0) from public.orders
                       where status = 'paid')
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_metrics(timestamptz) from public, anon;
grant execute on function public.admin_metrics(timestamptz) to authenticated;
