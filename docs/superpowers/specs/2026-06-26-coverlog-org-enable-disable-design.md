# Coverlog Org Enable/Disable (S2) — Design

**Status:** Approved direction (2026-06-26).

## Context

This is **S2 of the three-part internal/platform chunk** (S1 superadmin foundation ✅ merged; S3 curation follows):

- **S1 — Superadmin / platform foundation** (merged, main `94f9c24`): `superadmins` table + `getPlatformContext()` + gated top-level `/internal` shell.
- **S2 — Org enable/disable** (this spec): an `organizations.status` flag, an app-layer gate that blocks a disabled org's staff, and an `/internal/orgs` toggle (superadmin-only).
- **S3 — Curation surface** (later): `/internal/curation` over `src/lib/payers/curation.ts`, gated by the platform context.

## Goal

Let an internal Coverlog superadmin enable or disable a tenant organization. A disabled org's staff are blocked from the app (bounced to a notice page); a superadmin manages status from `/internal/orgs`.

## Decisions (resolved in brainstorming)

1. **`organizations.status`** is a text column: `not null default 'active' check (status in ('active','disabled'))`. (Text, not boolean — extensible to future states like `suspended`/`trial`.)
2. **Enforcement is app-layer** (not RLS-level): the `(app)` layout reads the current org's status and redirects when disabled. Server actions / API routes are **not** separately gated — RLS still isolates each org's data; a full RLS-level lockdown was the deferred stricter option.
3. **A disabled org's staff see a notice page** (`/org-disabled`): "access suspended, contact Coverlog" + Sign out. They remain signed in, but every tenant route redirects here (re-enabling restores access immediately).
4. **Disabling requires a confirmation** in the `/internal/orgs` UI; re-enabling is one click.
5. **Status changes are service-role-only** (no tenant update policy on `organizations`), gated behind `getPlatformContext` at the action layer.

## Foundation this builds on (already merged)

- `organizations` (migration `0001`): `(id, name, created_at)`. RLS on, with a tenant **select** policy `org_isolation_select` (`using (id = public.user_org_id())`) — so a signed-in staff member can read their **own** org row (incl. the new `status`). There is **no** update policy → updates require the service role.
- `getStaffContext(client)` → `{ orgId, staffId, role } | null` (`src/lib/auth/context.ts`); `getPlatformContext(client)` → `{ userId, email } | null` (`src/lib/auth/platform.ts`).
- `src/app/(app)/layout.tsx` (`force-dynamic`; `getStaffContext` → `redirect("/onboarding")` when null) — the single choke point all tenant pages render under.
- `src/app/internal/{layout.tsx,page.tsx}` — gated platform shell; the landing lists "Organizations" as a *coming soon* row (S2 turns it into a link).
- `createServiceSupabase()` (`src/lib/supabase/service.ts`) — service role, bypasses RLS; "NEVER import from a tenant-facing page/action/component." Used here only inside the superadmin-gated `/internal/orgs` action.
- `signOutAction` (`src/app/(app)/actions.ts`) — `signOut()` → `redirect("/sign-in")`; route-group-agnostic, reused by the notice page.
- Lib pattern (`src/lib/payers/curation.ts`): functions take `Pick<SupabaseClient,"from">`, throw `new Error("… failed: …")` on a Supabase error.
- UI primitives: `Badge` (`@/components/ui/Badge`, `statusColor()` map), `PageHeader`, `Card`, `@/lib/ui` table classes.
- Migrations run `0001`–`0016`; **next is `0017`**. Apply with `npm run db:reset`; test with `npm test` (vitest, serial). Test harness `tests/db/helpers.ts` (`pool`, `asAdmin`, `withClaims`, `resetDb`); real-auth pattern per `tests/db/audit-viewer.test.ts`.

## Architecture

One migration (a column), one new lib (cross-tenant org admin), one gate (in the existing `(app)` layout), one notice page, and one superadmin tool (`/internal/orgs` page + action). No change to tenant RLS, `getStaffContext`, or `getPlatformContext`.

### Unit 1 — Migration `0017_org_status.sql`

```sql
-- Org lifecycle status. 'disabled' blocks the org's staff from the tenant app
-- (enforced app-layer in (app)/layout.tsx). Managed only by the service role via
-- the superadmin /internal/orgs surface (organizations has no tenant update policy).
alter table public.organizations
  add column status text not null default 'active' check (status in ('active','disabled'));
```

Existing rows take the `'active'` default. No RLS change: the existing `org_isolation_select` policy already lets a member read its own row (now including `status`).

### Unit 2 — Org-admin lib `src/lib/orgs/admin.ts` (new)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgStatus = "active" | "disabled";
export type OrgRow = { id: string; name: string; status: OrgStatus; created_at: string };

// Cross-tenant list of all organizations. MUST be called with a service-role client
// (bypasses RLS); used only by the superadmin /internal/orgs surface.
export async function listAllOrgs(svc: Pick<SupabaseClient, "from">): Promise<OrgRow[]> {
  const { data, error } = await svc
    .from("organizations")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listAllOrgs failed: ${error.message}`);
  return (data ?? []) as OrgRow[];
}

// Set an org's status. Service-role client; the DB check constraint rejects bad values.
export async function setOrgStatus(
  svc: Pick<SupabaseClient, "from">, orgId: string, status: OrgStatus,
): Promise<void> {
  const { error } = await svc.from("organizations").update({ status }).eq("id", orgId);
  if (error) throw new Error(`setOrgStatus failed: ${error.message}`);
}
```

### Unit 3 — App-layer gate (modify `src/app/(app)/layout.tsx`)

After the existing `getStaffContext` guard, read the current org's status via the **request-bound** client (allowed by `org_isolation_select`) and redirect when disabled:

```tsx
if (!ctx) redirect("/onboarding");
const { data: org } = await supabase
  .from("organizations").select("status").eq("id", ctx.orgId).maybeSingle();
if (org?.status === "disabled") redirect("/org-disabled");
```

(Only this layout changes — it is the choke point every tenant page renders under.)

### Unit 4 — Notice page `src/app/org-disabled/page.tsx` (new, outside `(app)`)

A standalone server component (no auth gate — it is an informational page): a centered card reading "Your organization's access has been suspended. Please contact Coverlog." with a Sign out button (`<form action={signOutAction}>`, imported from `../(app)/actions`).

### Unit 5 — `/internal/orgs` (superadmin tool)

- **`src/app/internal/orgs/page.tsx`** (`force-dynamic`): re-resolve `getPlatformContext(createServerSupabase())`; `if (!platform) redirect("/sign-in")` (defense in depth — the `/internal` layout already gates). List orgs via `listAllOrgs(createServiceSupabase())` in a `Card` table: Name · Status (`<Badge value={status} />`) · Created · Action. The Action cell renders **Enable** (plain `<form action={setOrgStatusAction}>` button with `name="status" value="active"`) when disabled, and **Disable** (the confirm button, status `"disabled"`) when active. Each form carries a hidden `orgId`.
- **`src/app/internal/orgs/actions.ts`** — `"use server"`; `setOrgStatusAction(formData: FormData)`:
  1. `const platform = await getPlatformContext(await createServerSupabase()); if (!platform) redirect("/sign-in");` (re-verify superadmin — never trust the client).
  2. Read `orgId` (string) and `status` (must be `"active"` or `"disabled"`; ignore anything else) from `formData`.
  3. `await setOrgStatus(createServiceSupabase(), orgId, status)`.
  4. `revalidatePath("/internal/orgs")`.
- **`src/app/internal/orgs/_components/DisableButton.tsx`** — a `"use client"` submit button that calls `window.confirm("Disable this organization? Its staff will be locked out until re-enabled.")` and prevents submit if cancelled. Used for the Disable action only.
- **Wire the landing** (`src/app/internal/page.tsx`): turn the "Organizations" row from a *coming soon* label into a link to `/internal/orgs`. (Leave "Payer Curation" as *coming soon* — that is S3.)

## Data Flow

- Tenant page request → `(app)/layout.tsx` → `getStaffContext` → read own org `status` (RLS) → `disabled` ⇒ `/org-disabled`; else render.
- Superadmin → `/internal/orgs` (gated by `/internal` layout) → `listAllOrgs` (service role, all tenants) → toggle → `setOrgStatusAction` (re-verify `getPlatformContext`, then `setOrgStatus` via service role) → `revalidatePath`.

## Error Handling

- The gate's status read uses `maybeSingle()`; a missing/unreadable row (`org` null) is treated as **not disabled** (fail-open for the tenant's own access — consistent with the app's existing redirect-on-null-ctx behavior; a disabled flag is only ever set by a superadmin, so absence means active). A genuinely disabled org always has `status='disabled'`.
- `setOrgStatusAction` re-verifies superadmin before any write and ignores a `status` value that is not exactly `active`/`disabled` (defense beyond the DB check constraint).
- `listAllOrgs` / `setOrgStatus` throw on a Supabase error (surfaced to the superadmin).

## Security

- Status writes go through a service-role client **only inside** `setOrgStatusAction`, which first re-verifies `getPlatformContext`. No tenant code imports `createServiceSupabase`.
- **Carried from S1:** `getPlatformContext`'s env-allowlist bootstrap trusts `user.email`. `/internal/orgs` is genuine cross-tenant power, so for any real deployment enforce email confirmation, or prefer the `superadmins` table path over the env allowlist in prod.

## Testing

`tests/db/org-status.test.ts` (real-auth + service-role, mirrors existing DB tests):

- **Migration / default:** insert an org with no status (via `asAdmin`) → `status = 'active'`.
- **`setOrgStatus` flips status:** seed an org; `setOrgStatus(serviceClient, id, "disabled")` → re-read shows `disabled`; back to `"active"` → `active`.
- **`setOrgStatus` rejects an invalid value:** `setOrgStatus(serviceClient, id, "bogus" as any)` rejects (check-constraint violation → thrown error). Use `await expect(...).rejects`.
- **`listAllOrgs` is cross-tenant:** seed two orgs (A active, B disabled); `listAllOrgs(serviceClient)` returns both with correct statuses (service role bypasses RLS).
- **Tenant can read own status, not others':** with a real signed-in staff user of org A (anon-key client), `from("organizations").select("status").eq("id", A)` returns A's status; `.eq("id", B)` returns no row (RLS) — proving the gate's read works and stays org-scoped.
- The `serviceClient` is `createClient(URL, SERVICE, …)` (as in `audit-viewer.test.ts`).
- **Gate:** `npx tsc --noEmit`; `npm run build` (routes `/internal/orgs` and `/org-disabled` present); `npm test` green.

## Out of Scope

- RLS-level enforcement of disabled status (the deferred stricter option); separate gating of server actions / API routes.
- Org create/delete/rename, billing, or any other org attribute — only `status`.
- In-app superadmin management, curation UI (S3), audit-logging of status changes (could be a later enhancement).

## File Structure

- `supabase/migrations/0017_org_status.sql` — create.
- `src/lib/orgs/admin.ts` — create (`OrgStatus`, `OrgRow`, `listAllOrgs`, `setOrgStatus`).
- `src/app/(app)/layout.tsx` — modify (add the disabled-org gate).
- `src/app/org-disabled/page.tsx` — create (notice).
- `src/app/internal/orgs/page.tsx` — create; `src/app/internal/orgs/actions.ts` — create; `src/app/internal/orgs/_components/DisableButton.tsx` — create.
- `src/app/internal/page.tsx` — modify (Organizations row → link).
- `tests/db/org-status.test.ts` — create.
