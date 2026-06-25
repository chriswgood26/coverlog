-- Dashboard stat counts, computed server-side so date boundaries are anchored to
-- the DB's current_date (no JS timezone coupling) and returned in one round-trip.
-- SECURITY INVOKER so RLS on public.patients scopes the counts to the caller's org.
create or replace function public.dashboard_stats()
  returns table (verified_today bigint, due_this_week bigint, needs_attention bigint)
  language sql security invoker as $$
  select
    count(*) filter (where status = 'verified' and last_checked = current_date)                 as verified_today,
    count(*) filter (where next_due between current_date and current_date + 7)                   as due_this_week,
    count(*) filter (where status in ('pending','inactive'))                                     as needs_attention
  from public.patients
  where deleted_at is null;
$$;
