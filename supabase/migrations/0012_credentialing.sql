-- Link a patient to one of the org's canonical payer records (for the chart
-- coverage cross-reference). Nullable; free-text patients.primary_payer stays.
alter table public.patients
  add column primary_payer_directory_id uuid references public.payer_directory(id);

-- One enrollment row per (org, provider, payer) so the upsert in
-- src/lib/providers/mutations.ts is well-defined.
create unique index org_enrollment_unique
  on public.payer_enrollments (org_id, provider_id, payer_id);

-- Credentialing dashboard counts, computed server-side so the 60-day window is
-- anchored to the DB's current_date. SECURITY INVOKER so RLS on providers /
-- payer_enrollments scopes the counts to the caller's org. "Expiring" includes
-- already-overdue items (date <= current_date + 60 catches the past too).
create or replace function public.credentialing_stats()
  returns table (licenses_expiring bigint, revalidations_due bigint)
  language sql security invoker as $$
  select
    (select count(*) from public.providers
       where deleted_at is null
         and license_expiration is not null
         and license_expiration <= current_date + 60)                       as licenses_expiring,
    (select count(*) from public.payer_enrollments
       where revalidation_due is not null
         and revalidation_due <= current_date + 60
         and status <> 'terminated')                                        as revalidations_due;
$$;
