create table public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  patient_id uuid references public.patients(id) not null,
  consent_type text not null,
  scope text,
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  document_ref text,
  created_by uuid references public.staff(id),
  created_at timestamptz default now()
);

create table public.disclosure_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  patient_id uuid references public.patients(id),
  actor_staff_id uuid references public.staff(id),
  action text not null,
  purpose text,
  disclosed_to text,
  occurred_at timestamptz default now(),
  detail jsonb
);

create table public.access_log (
  id uuid default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  actor_staff_id uuid references public.staff(id),
  action text not null,
  patient_id uuid references public.patients(id),
  patient_ids uuid[],
  query_context text,
  occurred_at timestamptz default now(),
  detail jsonb,
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- Initial monthly partitions (the later cron/ops plan adds rolling creation).
create table public.access_log_2026_06 partition of public.access_log
  for values from ('2026-06-01') to ('2026-07-01');
create table public.access_log_2026_07 partition of public.access_log
  for values from ('2026-07-01') to ('2026-08-01');

create index consents_patient_idx on public.patient_consents(patient_id);
create index disclosure_patient_idx on public.disclosure_log(org_id, patient_id);
create index access_actor_idx on public.access_log(org_id, actor_staff_id);

alter table public.patient_consents enable row level security;
alter table public.disclosure_log enable row level security;
alter table public.access_log enable row level security;

create policy consents_isolation_all on public.patient_consents
  for all using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());

-- Append-only: insert + select within the org, no update/delete policy granted.
create policy disclosure_insert on public.disclosure_log
  for insert with check (org_id = public.user_org_id());
create policy disclosure_select on public.disclosure_log
  for select using (org_id = public.user_org_id());

create policy access_insert on public.access_log
  for insert with check (org_id = public.user_org_id());
create policy access_select on public.access_log
  for select using (org_id = public.user_org_id());

-- Enforce append-only at the trigger level: RLS alone silently returns 0 rows on
-- UPDATE/DELETE (no policy = no visible rows), but does not raise an error.
-- A statement-level trigger fires even when 0 rows match, ensuring the hard
-- guarantee is enforced and makes the attempted mutation explicit as an error.
create or replace function public.access_log_append_only()
  returns trigger language plpgsql security definer as $$
begin
  raise exception 'permission denied: access_log is append-only, % is not permitted', TG_OP
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger access_log_no_update
  before update or delete on public.access_log
  for each statement execute function public.access_log_append_only();
