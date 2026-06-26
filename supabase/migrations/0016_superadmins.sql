-- Platform-level "superadmin" (internal Coverlog staff). NOT org-scoped and NOT a
-- tenant staff member: a Supabase Auth user with elevated, cross-tenant access used
-- by the /internal surface (org management, payer curation). Source of truth for who
-- is a superadmin; the SUPERADMIN_EMAILS env allowlist is an additional bootstrap path.
create table public.superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now()
);

alter table public.superadmins enable row level security;

-- A user may read ONLY their own superadmin row — enough for getPlatformContext()
-- to check its own membership via the request-bound client. No cross-user reads, and
-- no insert/update/delete policy → the table is managed only via the service role
-- (in-app management is a later plan).
create policy superadmins_self_read on public.superadmins
  for select to authenticated using (user_id = auth.uid());

grant select on public.superadmins to authenticated;
revoke all on public.superadmins from anon;
