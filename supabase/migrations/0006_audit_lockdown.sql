-- ============================================================
-- 0006_audit_lockdown.sql — Fix C1, C2, C3 security findings
-- ============================================================
-- C1: Partition children have no RLS. Enable + force RLS on each child,
--     and add the same isolation/append-only policies as the parent.
-- C2: Tenants can TRUNCATE/UPDATE/DELETE audit tables. Revoke destructive
--     grants (TRUNCATE is not constrained by RLS and bypasses triggers).
-- C3: Append-only trigger bypassed via partition child. Attach the
--     audit_append_only trigger directly to each child partition.
-- ============================================================

-- C1 + C3: Enable RLS and force it on partition children, add isolation
--          policies, and attach the append-only trigger to each child.

alter table public.access_log_2026_06 enable row level security;
alter table public.access_log_2026_06 force row level security;
alter table public.access_log_2026_07 enable row level security;
alter table public.access_log_2026_07 force row level security;

-- Partition children do NOT inherit parent policies for direct access.
-- Add isolation policies to each child matching the parent's policies.
create policy access_2026_06_select on public.access_log_2026_06
  for select using (org_id = public.user_org_id());
create policy access_2026_06_insert on public.access_log_2026_06
  for insert with check (org_id = public.user_org_id());

create policy access_2026_07_select on public.access_log_2026_07
  for select using (org_id = public.user_org_id());
create policy access_2026_07_insert on public.access_log_2026_07
  for insert with check (org_id = public.user_org_id());

-- C3: Attach append-only trigger to each child partition so direct DML
--     against the child is blocked, not just DML through the parent.
create trigger access_2026_06_append_only
  before update or delete on public.access_log_2026_06
  for each statement execute function public.audit_append_only();

create trigger access_2026_07_append_only
  before update or delete on public.access_log_2026_07
  for each statement execute function public.audit_append_only();

-- C2: Revoke destructive grants on all audit tables and their partitions
--     from tenant roles. TRUNCATE bypasses RLS and triggers entirely —
--     only removing the privilege at the grant level closes this hole.
revoke update, delete, truncate
  on public.access_log, public.access_log_2026_06, public.access_log_2026_07,
     public.disclosure_log
  from anon, authenticated;

-- Harden anon: unauthenticated sessions should have NO access to tenant
-- data at all. Revoke all object-level grants from anon on every tenant table.
revoke all
  on public.organizations, public.staff, public.patients, public.eligibility_checks,
     public.payer_directory, public.providers, public.payer_enrollments,
     public.payer_code_coverage, public.payer_claim_rules,
     public.patient_consents, public.disclosure_log,
     public.access_log, public.access_log_2026_06, public.access_log_2026_07
  from anon;

-- Ensure authenticated role retains the grants it needs for RLS to function
-- on all tenant tables (explicit grants replace what default privileges gave).
-- Audit tables get insert+select only (no update/delete/truncate per above).
grant select, insert, update, delete
  on public.organizations, public.staff, public.patients, public.eligibility_checks,
     public.payer_directory, public.providers, public.payer_enrollments,
     public.payer_code_coverage, public.payer_claim_rules, public.patient_consents
  to authenticated;

grant select, insert
  on public.disclosure_log,
     public.access_log, public.access_log_2026_06, public.access_log_2026_07
  to authenticated;
