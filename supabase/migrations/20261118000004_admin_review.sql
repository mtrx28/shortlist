-- Shortlist: approve or reject a verification request in one transaction.
--
-- Before this, the server action wrote the audit row, then changed the profile,
-- and removed the audit row again if the change failed. Two separate calls can
-- never be one transaction, so this function does both inside the database:
-- either the status changes AND the audit row is written, or nothing happens.
--
-- It is "security definer" so it can write columns the admin has no grant for.
-- It does not trust its caller: it re-checks that p_admin really is an admin
-- and that the target is still pending. EXECUTE is given to service_role only,
-- so a signed-in user (even an admin) cannot call it from the browser; only
-- our server can, after its own requireAdmin() check.
--
-- Errors (the app maps these messages):
--   not_admin    p_admin is not an active admin
--   not_pending  the target is not waiting for a decision (already handled)
--   bad_decision p_decision is not 'approve' or 'reject'
create function public.admin_review_verification(
  p_admin uuid,
  p_target uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'bad_decision' using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from public.profiles
     where id = p_admin
       and role = 'admin'
       and suspended_at is null
       and deleted_at is null
  ) then
    raise exception 'not_admin' using errcode = 'insufficient_privilege';
  end if;

  -- Lock the row so two admins clicking at once cannot both succeed.
  perform 1 from public.profiles
   where id = p_target and elitmus_status = 'pending'
   for update;
  if not found then
    raise exception 'not_pending' using errcode = 'no_data_found';
  end if;

  if p_decision = 'approve' then
    update public.profiles set elitmus_status = 'verified' where id = p_target;
  else
    -- Back to "none" and forget the hash, so the person can try again with the
    -- right ID (the hash is unique per account and would otherwise block it).
    update public.profiles
       set elitmus_status = 'none', elitmus_ref_hash = null
     where id = p_target;
  end if;

  insert into public.audit_log (admin_id, action, target)
  values (
    p_admin,
    case when p_decision = 'approve' then 'verification_approved'
         else 'verification_rejected' end,
    'profile:' || p_target::text
  );

  return case when p_decision = 'approve' then 'approved' else 'rejected' end;
end;
$$;

revoke execute on function public.admin_review_verification(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_review_verification(uuid, uuid, text)
  to service_role;
