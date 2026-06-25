create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  user_id uuid unique,                 -- references auth.users(id) in Supabase
  name text not null,
  email text not null,
  role text not null default 'specialist' check (role in ('admin','specialist')),
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create index staff_user_id_idx on public.staff(user_id) where deleted_at is null;

-- Resolve the current user's org. SECURITY DEFINER so the lookup itself isn't
-- blocked by RLS on staff. STABLE so the planner can cache within a statement.
create or replace function public.user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.staff
  where user_id = auth.uid() and deleted_at is null
  limit 1
$$;

alter table public.organizations enable row level security;
alter table public.staff enable row level security;

create policy org_isolation_select on public.organizations
  for select using (id = public.user_org_id());

create policy staff_isolation_all on public.staff
  for all using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());
