-- Atomic "log a check": insert history row + update the parent patient together.
-- SECURITY INVOKER so RLS applies as the calling tenant; org_id and checked_by are
-- derived server-side (never trusted from the client).
create or replace function public.log_eligibility_check(
  p_patient_id uuid,
  p_payer text,
  p_status text,
  p_copay numeric,
  p_deductible_remaining numeric,
  p_notes text,
  p_next_due date
) returns uuid
  language plpgsql security invoker as $$
declare
  v_org uuid := public.user_org_id();
  v_staff uuid;
  v_check_id uuid;
begin
  select id into v_staff from public.staff
    where user_id = auth.uid() and deleted_at is null limit 1;

  -- RLS-scoped existence guard: SECURITY INVOKER means this exists() only sees the
  -- patient if it belongs to the caller's org. Blocks a cross-org / nonexistent
  -- p_patient_id from writing an orphan check row (the patient UPDATE is already a
  -- no-op under RLS, but the insert would otherwise succeed with org_id = caller's).
  if not exists (
    select 1 from public.patients
    where id = p_patient_id and deleted_at is null
  ) then
    raise exception 'patient % not found in caller org', p_patient_id
      using errcode = 'no_data_found';
  end if;

  insert into public.eligibility_checks
    (org_id, patient_id, checked_by, payer, status, copay, deductible_remaining, notes, check_date, next_due)
  values
    (v_org, p_patient_id, v_staff, p_payer, p_status, p_copay, p_deductible_remaining, p_notes, current_date, p_next_due)
  returning id into v_check_id;

  update public.patients
    set status = p_status,
        last_checked = current_date,
        next_due = p_next_due,
        primary_payer = coalesce(p_payer, primary_payer)
  where id = p_patient_id and deleted_at is null;

  return v_check_id;
end;
$$;
