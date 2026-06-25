create table public.providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  name text not null,
  npi text,
  license_type text,
  license_number text,
  license_state text,
  license_expiration date,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.payer_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  provider_id uuid references public.providers(id) not null,
  payer_id uuid references public.payer_directory(id) not null,
  status text not null default 'pending'
    check (status in ('enrolled','pending','terminated','not_enrolled')),
  par_status text check (par_status in ('in_network','out_of_network')),
  effective_date date,
  termination_date date,
  revalidation_due date,
  caqh_id text,
  notes text,
  created_at timestamptz default now()
);

create table public.payer_code_coverage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),     -- NULL = Coverlog baseline
  payer_id uuid references public.payer_directory(id) not null,
  cpt_code text not null,
  code_description text,
  covered boolean default true,
  requires_prior_auth boolean default false,
  unit_limit text,
  modifier_required text,
  telehealth_allowed boolean,
  notes text,
  effective_date date,
  source text not null default 'org' check (source in ('coverlog_baseline','org')),
  verified_at timestamptz,
  verified_by text,
  promoted_from_org uuid,
  created_at timestamptz default now()
);

create table public.payer_claim_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),     -- NULL = Coverlog baseline
  payer_id uuid references public.payer_directory(id) not null,
  rule_category text,
  field_reference text,
  rule_description text,
  required_value text,
  notes text,
  source text not null default 'org' check (source in ('coverlog_baseline','org')),
  verified_at timestamptz,
  verified_by text,
  promoted_from_org uuid,
  created_at timestamptz default now()
);

alter table public.providers enable row level security;
alter table public.payer_enrollments enable row level security;
alter table public.payer_code_coverage enable row level security;
alter table public.payer_claim_rules enable row level security;

create policy providers_isolation_all on public.providers
  for all using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
create policy enrollments_isolation_all on public.payer_enrollments
  for all using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());

-- Hybrid: read baseline (org_id is null) OR your own; write your own only.
create policy coverage_read on public.payer_code_coverage
  for select using (org_id is null or org_id = public.user_org_id());
create policy coverage_write on public.payer_code_coverage
  for insert with check (org_id = public.user_org_id());
create policy coverage_update on public.payer_code_coverage
  for update using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
create policy coverage_delete on public.payer_code_coverage
  for delete using (org_id = public.user_org_id());

create policy rules_read on public.payer_claim_rules
  for select using (org_id is null or org_id = public.user_org_id());
create policy rules_write on public.payer_claim_rules
  for insert with check (org_id = public.user_org_id());
create policy rules_update on public.payer_claim_rules
  for update using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
create policy rules_delete on public.payer_claim_rules
  for delete using (org_id = public.user_org_id());
