-- Shortlist: saving a weekly drop safely.
--
-- The matching engine (TypeScript) works out who is shown to whom. This
-- function saves the result. It is a function, not a few separate inserts,
-- so that a drop is written all at once or not at all, and so that running
-- the same week twice cannot create duplicates.
--
-- What it does for a given week (a Monday):
--   * No drop yet for that week: create it and its intros.
--   * A demo drop exists (the seed marks it stats.demo = true) and
--     p_replace_demo is true: delete it, with its intros, and create the real
--     one. This only ever removes demo rows.
--   * A real drop exists and p_rebuild is false: do nothing, say 'exists'.
--   * A real drop exists and p_rebuild is true: replace it, but only if
--     nobody has acted on it yet (every intro still 'new'). Otherwise do
--     nothing and say 'blocked', so a re-run can never wipe someone's answers.
--
-- "security definer" lets it write tables normal users cannot touch.
-- EXECUTE goes to service_role only: the app server calls it after its own
-- checks (cron secret or admin), never the browser.
--
-- p_intros is a JSON array of
--   { "viewer_id": uuid, "candidate_id": uuid, "score": number, "reasons": [text] }
-- The table's own constraints still apply (no self-intro, one row per pair).
create function public.write_drop(
  p_week_start date,
  p_stats jsonb,
  p_intros jsonb,
  p_replace_demo boolean default true,
  p_rebuild boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing record;
  new_id uuid;
  inserted integer;
begin
  if jsonb_typeof(p_intros) is distinct from 'array' then
    raise exception 'p_intros must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  select id, coalesce(stats ->> 'demo', 'false') = 'true' as is_demo
    into existing
    from public.drops
   where week_start = p_week_start
   for update;

  if found then
    if existing.is_demo and p_replace_demo then
      delete from public.drops where id = existing.id;   -- its intros go with it
    elsif p_rebuild then
      if exists (
        select 1 from public.intros where drop_id = existing.id and status <> 'new'
      ) then
        return jsonb_build_object('status', 'blocked', 'drop_id', existing.id);
      end if;
      delete from public.drops where id = existing.id;
    else
      return jsonb_build_object('status', 'exists', 'drop_id', existing.id);
    end if;
  end if;

  -- If two runs race, the unique week_start lets only one insert through.
  insert into public.drops (week_start, stats)
  values (p_week_start, coalesce(p_stats, '{}'::jsonb))
  on conflict (week_start) do nothing
  returning id into new_id;

  if new_id is null then
    return jsonb_build_object('status', 'exists');
  end if;

  insert into public.intros (drop_id, viewer_id, candidate_id, score, reasons)
  select new_id, x.viewer_id, x.candidate_id, x.score, coalesce(x.reasons, '[]'::jsonb)
    from jsonb_to_recordset(p_intros)
      as x(viewer_id uuid, candidate_id uuid, score numeric, reasons jsonb);
  get diagnostics inserted = row_count;

  return jsonb_build_object('status', 'created', 'drop_id', new_id, 'intros', inserted);
end;
$$;

revoke execute on function public.write_drop(date, jsonb, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.write_drop(date, jsonb, jsonb, boolean, boolean)
  to service_role;
