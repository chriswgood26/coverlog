-- Canonical, Coverlog-curated payer identity. Global (no org_id): every tenant
-- reads the same master list; only the service-role curation surface writes it.
create table public.payer_master (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  payer_type text,                         -- e.g. 'medicaid' | 'medicare' | 'commercial'
  created_at timestamptz default now()
);

alter table public.payer_master enable row level security;

-- Every authenticated tenant may read the master list. No write policy for
-- anon/authenticated → inserts/updates/deletes are denied for them; the curation
-- surface writes via the service role (which bypasses RLS).
create policy payer_master_read on public.payer_master
  for select to authenticated using (true);

-- Tenants must hold the base grant for RLS to even be evaluated (Plan 1 db-reset
-- no longer grants tenant roles broadly by default).
grant select on public.payer_master to authenticated;
revoke all on public.payer_master from anon;

-- Link each org's payer_directory row to a canonical payer (nullable: an org may
-- track a local-only payer not yet in master).
alter table public.payer_directory
  add column payer_master_id uuid references public.payer_master(id);

-- Repoint baseline + override coverage/claim rows at the canonical payer.
-- (0003 pointed these at the per-org payer_directory, which cannot key a global baseline.)
alter table public.payer_code_coverage drop constraint payer_code_coverage_payer_id_fkey;
alter table public.payer_code_coverage rename column payer_id to payer_master_id;
alter table public.payer_code_coverage
  add constraint payer_code_coverage_payer_master_id_fkey
  foreign key (payer_master_id) references public.payer_master(id);

alter table public.payer_claim_rules drop constraint payer_claim_rules_payer_id_fkey;
alter table public.payer_claim_rules rename column payer_id to payer_master_id;
alter table public.payer_claim_rules
  add constraint payer_claim_rules_payer_master_id_fkey
  foreign key (payer_master_id) references public.payer_master(id);

create index coverage_payer_idx on public.payer_code_coverage(payer_master_id, cpt_code);
create index claimrules_payer_idx on public.payer_claim_rules(payer_master_id, rule_category);
