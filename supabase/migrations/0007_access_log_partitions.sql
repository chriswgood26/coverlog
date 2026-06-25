-- Create a monthly access_log partition (if absent) fully locked down to match
-- the Plan 1 audit hardening: forced RLS + org-scoped policies + append-only
-- trigger + revoked tenant DML. Idempotent; safe to call repeatedly.
create or replace function public.ensure_access_log_partition(p_month date)
  returns void language plpgsql security definer
  set search_path = public, pg_temp as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_part  text := format('access_log_%s', to_char(v_start, 'YYYY_MM'));
begin
  if to_regclass(format('public.%I', v_part)) is not null then
    return;
  end if;

  execute format(
    'create table public.%I partition of public.access_log for values from (%L) to (%L)',
    v_part, v_start, v_end);

  execute format('alter table public.%I enable row level security', v_part);
  execute format('alter table public.%I force row level security', v_part);
  execute format(
    'create policy %I on public.%I for select using (org_id = public.user_org_id())',
    v_part || '_select', v_part);
  execute format(
    'create policy %I on public.%I for insert with check (org_id = public.user_org_id())',
    v_part || '_insert', v_part);
  execute format(
    'create trigger %I before update or delete on public.%I for each statement execute function public.audit_append_only()',
    v_part || '_append_only', v_part);
  execute format(
    'revoke update, delete, truncate on public.%I from anon, authenticated', v_part);
  execute format(
    'revoke all on public.%I from anon', v_part);
  execute format(
    'grant select, insert on public.%I to authenticated', v_part);
end;
$$;

-- Provision the near-future partitions so inserts never hit a missing range.
select public.ensure_access_log_partition('2026-08-01');
select public.ensure_access_log_partition('2026-09-01');
select public.ensure_access_log_partition('2026-10-01');
select public.ensure_access_log_partition('2026-11-01');
select public.ensure_access_log_partition('2026-12-01');
select public.ensure_access_log_partition('2027-01-01');
