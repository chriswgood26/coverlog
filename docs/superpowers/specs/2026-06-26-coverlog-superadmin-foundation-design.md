# Coverlog Superadmin / Platform Foundation (S1) — Design

**Status:** Approved direction (2026-06-26).

## Context

This is **S1 of a three-part chunk** that adds an internal Coverlog ("platform") layer above org-admin:

- **S1 — Superadmin / platform foundation** (this spec): a platform-level identity above org-admin, a `getPlatformContext()` resolver, and a gated top-level `/internal` shell. The gate everything else hangs off.
- **S2 — Org enable/disable** (later): `organizations.status` + an app-layer gate that blocks a disabled org's staff + an `/internal/orgs` toggle.
- **S3 — Curation surface** (later): `/internal/curation` over the existing `src/lib/payers/curation.ts` (master payers + baseline coverage + baseline claim rules), gated by the platform context.

Each is its own spec → plan → build cycle. This spec covers **S1 only**.

## Goal

Establish a platform-level "superadmin" (internal Coverlog staff) — an authenticated Supabase user with **no tenant `staff` row** — and a top-level `/internal` area gated to superadmins. S1 ships the identity model, the resolver, and the gated shell with a landing page; S2 and S3 fill in the actual tools.

## Decisions (resolved in brainstorming)

1. **Superadmin model:** a `public.superadmins` table is the source of truth, **plus** a `SUPERADMIN_EMAILS` env allowlist as the bootstrap path (so the very first superadmin works with no manual SQL). `getPlatformContext()` treats *either* as superadmin.
2. **Superadmins are platform-level:** they are Supabase Auth users with **no `staff` row** (so `getStaffContext` returns `null` for them — they do not use the tenant `(app)` shell). `/internal/*` uses `getPlatformContext()` instead.
3. **`/internal` lives outside the tenant `(app)` route group** so it does not hit the org gate (`getStaffContext` → `/onboarding`).
4. **Out of scope for S1:** in-app add/remove of superadmins (bootstrap via env for now; in-app management can come later), org enable/disable (S2), curation UI (S3).
5. **Org-disable enforcement (S2, recorded here for context):** app-layer gate, not RLS-level.

## Foundation this builds on (already merged)

- `getStaffContext(client)` in `src/lib/auth/context.ts` — resolves the Auth user, then looks up a non-deleted `staff` row by `user_id`; returns `{ orgId, staffId, role }` or `null`. The platform resolver mirrors its shape.
- The tenant shell: `src/app/(app)/layout.tsx` (`force-dynamic`; `getStaffContext` → `redirect("/onboarding")` when null) + `src/app/(app)/_components/Sidebar.tsx` + `signOutAction` in `src/app/(app)/actions.ts` (`supabase.auth.signOut()` → `redirect("/sign-in")`).
- RLS convention (e.g. migration `0010` `payer_master`): `enable row level security`; a narrow `select` policy; `grant select … to authenticated`; `revoke all … from anon`. Tables with no write policy are writable only via the service role (which bypasses RLS).
- `createServerSupabase()` (request-bound, RLS-scoped) in `src/lib/supabase/server.ts`. `createServiceSupabase()` (service role, bypasses RLS) in `src/lib/supabase/service.ts` — **not needed for S1**.
- Test harness: `tests/db/helpers.ts` (`pool`, `asAdmin`, `withClaims`, `resetDb`); real-auth pattern (`admin.auth.admin.createUser` + `signInWithPassword`, delete by captured id), e.g. `tests/db/audit-viewer.test.ts`. `auth.uid()` resolves from the JWT `sub` claim (set by `withClaims` and by real sign-in).
- Migrations run `0001`–`0015`; **next is `0016`**.

## Architecture

Three units: a migration (the `superadmins` table), a resolver (`getPlatformContext`), and a gated `/internal` shell (layout + landing). No service role, no tenant code touched.

### Unit 1 — Migration `0016_superadmins.sql`

```sql
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
```

`on delete cascade` keeps the table clean when an Auth user is removed (and lets the real-auth tests clean up by deleting the user).

### Unit 2 — `getPlatformContext` in `src/lib/auth/platform.ts` (new file)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformContext = { userId: string; email: string };

// Resolve the current Supabase Auth user to a platform (superadmin) context.
// Superadmin iff the user's email is in the SUPERADMIN_EMAILS allowlist (bootstrap)
// OR a public.superadmins row exists for them (read via the self-read RLS policy).
// Returns null if unauthenticated or not a superadmin.
export async function getPlatformContext(
  client: Pick<SupabaseClient, "auth" | "from">,
): Promise<PlatformContext | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const email = user.email ?? "";
  const allow = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && allow.includes(email.toLowerCase())) {
    return { userId: user.id, email };
  }

  const { data } = await client
    .from("superadmins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return { userId: user.id, email };
}
```

- Mirrors `getStaffContext`'s shape and `client` typing (`Pick<SupabaseClient, "auth" | "from">`).
- The env path short-circuits before the DB read (bootstrap works even before any row exists). The table path uses the self-read policy, so the request-bound client sees only its own row.

### Unit 3 — Gated `/internal` shell

**`src/app/internal/layout.tsx`** (top-level, NOT under `(app)`):

```tsx
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPlatformContext } from "@/lib/auth/platform";
import { signOutAction } from "../(app)/actions";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  // header with "Coverlog · Internal" + signed-in email + Sign out (signOutAction) + <main>{children}</main>
}
```

- Reuses the existing `signOutAction` (imported from `../(app)/actions`) — it is route-group-agnostic (`signOut()` → `/sign-in`).
- A distinct internal chrome (a slate top bar reading **"Coverlog · Internal"**, the signed-in email, and Sign out) so it is visually obvious this is the platform area, not a tenant org. No tenant `Sidebar`.

**`src/app/internal/page.tsx`** — landing:

- `PageHeader title="Internal" subtitle={platform.email}` (re-resolve `getPlatformContext`; if null `redirect("/sign-in")` — defense in depth, the layout already gated).
- A "Tools" `Card` listing the internal tools. S1 has no tool pages yet, so list **Organizations** and **Payer Curation** as plain, non-linked rows labeled *"coming soon"*. S2 and S3 will turn these into links to `/internal/orgs` and `/internal/curation`.

## Data Flow

A request to `/internal/*` → `InternalLayout` resolves `getPlatformContext(createServerSupabase())` → non-superadmin (incl. signed-out and ordinary tenant users) → `redirect("/sign-in")`; superadmin → renders the internal chrome + page. No tenant data, no service role, no PHI — nothing in S1 reads org-scoped or patient data.

## Error Handling

- The resolver returns `null` (not throw) for unauthenticated/non-superadmin; the layout redirects. No new mutation paths in S1.
- A malformed/empty `SUPERADMIN_EMAILS` yields an empty allowlist (the `.filter(Boolean)` drops blanks) → falls through to the table check.
- The table read tolerates "no row" via `maybeSingle()` → `null`.

## Testing

`tests/db/superadmin.test.ts` (real-auth, mirrors `audit-viewer.test.ts`):

- **Setup:** create one Auth user via `admin.auth.admin.createUser`; sign in a `userClient` (anon-key client) with `signInWithPassword`. Also create a *second* Auth user for the cross-user RLS check.
- **env-allowlist path:** set `process.env.SUPERADMIN_EMAILS` to the user's email; `getPlatformContext(userClient)` → `{ userId, email }` (truthy). Restore the env var after.
- **table path:** with `SUPERADMIN_EMAILS` unset/empty, seed `public.superadmins (user_id, email)` for the user via `asAdmin`; `getPlatformContext(userClient)` → truthy (proves the self-read policy + table branch).
- **non-superadmin → null:** a signed-in user with no `superadmins` row and email not in the allowlist → `getPlatformContext` returns `null`.
- **anon → null:** a fresh anon-key client with no session → `getPlatformContext` returns `null`.
- **self-read RLS isolation:** signed in as user A (who has a `superadmins` row), a direct `userClientA.from("superadmins").select("user_id").eq("user_id", <userB's id>)` returns no rows (A cannot read B's superadmin row).
- **Cleanup (`afterAll`):** `admin.auth.admin.deleteUser` for both users (cascade-removes their `superadmins` rows), `truncate public.superadmins`, `resetDb()`, `pool.end()`. Restore `SUPERADMIN_EMAILS` to its original value.

**Gate:** `npx tsc --noEmit`; `npm run build` (the `/internal` route compiles); `npm test` green (existing suite + the new test).

## Out of Scope

- In-app add/remove of superadmins (bootstrap via `SUPERADMIN_EMAILS` for now). The `superadmins` table + self-read policy are in place so a later plan can add management via the service role.
- Org enable/disable (`organizations.status`) and the disabled-org gate — **S2**.
- The curation UI over `curation.ts` — **S3**.
- Any change to tenant auth (`getStaffContext`), RLS on tenant tables, or the `(app)` shell.

## File Structure

- `supabase/migrations/0016_superadmins.sql` — create (table + self-read RLS + grants).
- `src/lib/auth/platform.ts` — create (`PlatformContext`, `getPlatformContext`).
- `src/app/internal/layout.tsx` — create (gated internal chrome).
- `src/app/internal/page.tsx` — create (landing + tools list).
- `tests/db/superadmin.test.ts` — create.
