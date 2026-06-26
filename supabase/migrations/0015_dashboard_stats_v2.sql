-- Extend credentialing_stats with provider-status counts for the dashboard.
-- SECURITY INVOKER → RLS scopes all counts to the caller's org. Superset of the
-- 0012 shape (existing two columns stay first).
-- Drop first because PostgreSQL does not allow create or replace to change return type.
drop function if exists public.credentialing_stats();
create or replace function public.credentialing_stats()
  returns table (licenses_expiring bigint, revalidations_due bigint,
                 total_providers bigint, pending_review bigint, flagged bigint)
  language sql security invoker as $$
  select
    (select count(*) from public.providers
       where deleted_at is null and license_expiration is not null
         and license_expiration <= current_date + 60),
    (select count(*) from public.payer_enrollments
       where revalidation_due is not null and revalidation_due <= current_date + 60
         and status <> 'terminated'),
    (select count(*) from public.providers where deleted_at is null),
    (select count(*) from public.providers where deleted_at is null and status = 'pending'),
    (select count(*) from public.providers where deleted_at is null and status = 'flagged');
$$;
