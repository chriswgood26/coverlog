-- Provider credentialing status + specialty (CredFlow mockup §8.1).
-- Existing rows default to 'active'. RLS (providers_isolation_all) unchanged.
alter table public.providers
  add column status text not null default 'active'
  check (status in ('active','pending','flagged'));
alter table public.providers add column specialty text;
