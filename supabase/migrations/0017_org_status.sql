-- Org lifecycle status. 'disabled' blocks the org's staff from the tenant app
-- (enforced app-layer in (app)/layout.tsx). Managed only by the service role via
-- the superadmin /internal/orgs surface (organizations has no tenant update policy).
alter table public.organizations
  add column status text not null default 'active' check (status in ('active','disabled'));
