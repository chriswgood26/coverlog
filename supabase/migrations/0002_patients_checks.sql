create table public.patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  name text not null,
  dob date,
  member_id text,
  primary_payer text,
  status text not null default 'pending' check (status in ('verified','pending','inactive')),
  last_checked date,
  next_due date,
  part2_protected boolean not null default true,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  patient_id uuid references public.patients(id) not null,
  checked_by uuid references public.staff(id),
  payer text,
  status text check (status in ('verified','pending','inactive')),
  copay numeric,
  deductible_remaining numeric,
  notes text,
  check_date date default current_date,
  next_due date,
  source text not null default 'manual',
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.payer_directory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  payer_name text not null,
  portal_url text,
  login_notes text,
  username_hint text,
  last_checked_here date
);

create index patients_next_due_idx on public.patients(org_id, next_due) where deleted_at is null;
create index checks_patient_idx on public.eligibility_checks(patient_id) where deleted_at is null;

alter table public.patients enable row level security;
alter table public.eligibility_checks enable row level security;
alter table public.payer_directory enable row level security;

create policy patients_isolation_all on public.patients
  for all using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
create policy checks_isolation_all on public.eligibility_checks
  for all using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
create policy payerdir_isolation_all on public.payer_directory
  for all using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
