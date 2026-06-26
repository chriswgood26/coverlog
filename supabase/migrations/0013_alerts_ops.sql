-- Per-org alert counts for the weekly digest. SECURITY DEFINER (the cron runs as
-- the service role with no user session, so an INVOKER function would see nothing);
-- isolation comes from the explicit p_org_id filter, not RLS. Execute is locked to
-- the service role so a tenant can't read another org's counts.
create or replace function public.org_alert_counts(p_org_id uuid)
  returns table (licenses_expiring bigint, revalidations_due bigint,
                 consents_expiring bigint, due_this_week bigint, needs_attention bigint)
  language sql security definer set search_path = public, pg_temp as $$
  select
    (select count(*) from public.providers
       where org_id = p_org_id and deleted_at is null
         and license_expiration is not null and license_expiration <= current_date + 60),
    (select count(*) from public.payer_enrollments
       where org_id = p_org_id and revalidation_due is not null
         and revalidation_due <= current_date + 60 and status <> 'terminated'),
    (select count(*) from public.patient_consents
       where org_id = p_org_id and revoked_at is null
         and expires_at is not null and expires_at <= current_date + 60),
    (select count(*) from public.patients
       where org_id = p_org_id and deleted_at is null
         and next_due between current_date and current_date + 7),
    (select count(*) from public.patients
       where org_id = p_org_id and deleted_at is null
         and status in ('pending','inactive'));
$$;

revoke all on function public.org_alert_counts(uuid) from public, anon, authenticated;
grant execute on function public.org_alert_counts(uuid) to service_role;

-- Roll the access_log partition runway forward: ensure partitions for the current
-- month through current+p_months exist (idempotent; reuses the locked-down creator).
create or replace function public.ensure_upcoming_access_log_partitions(p_months int)
  returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare m int;
begin
  for m in 0..p_months loop
    perform public.ensure_access_log_partition(
      (date_trunc('month', current_date) + (m || ' months')::interval)::date);
  end loop;
  return p_months + 1;
end;
$$;

revoke all on function public.ensure_upcoming_access_log_partitions(int) from public, anon, authenticated;
grant execute on function public.ensure_upcoming_access_log_partitions(int) to service_role;
