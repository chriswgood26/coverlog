# Coverlog Provider Credentialing (Module 8.1) — Design

**Status:** Approved (2026-06-25)
**Plan:** 3b of the Module 8 arc (3a payer intelligence ✅ → **3b credentialing** → 3c consent admin).
**Spec source:** Coverlog Technical Specification §8.1 (Provider Credentialing Tracker) and §8.4 (Payer Profile view — "Enrolled Providers" tab).

## Goal

Turn the credentialing tables into a working surface: a Providers page (list/add/edit with license + expiration), per-payer enrollment management surfaced as the **Enrolled Providers** tab on the Payer Profile, two new dashboard alert cards ("Licenses expiring soon", "Enrollments due for revalidation"), and a patient-chart cross-reference from a patient's payer to that payer's covered codes.

## Foundation this builds on (already merged)

- **Migration `0003`** already created both credentialing tables with full org-isolation RLS:
  - `public.providers(id, org_id, name, npi, license_type, license_number, license_state, license_expiration, created_at, deleted_at)` — RLS `providers_isolation_all` (`for all using/with check org_id = public.user_org_id()`).
  - `public.payer_enrollments(id, org_id, provider_id → providers(id), payer_id → payer_directory(id), status ∈ {enrolled,pending,terminated,not_enrolled} default 'pending', par_status ∈ {in_network,out_of_network}, effective_date, termination_date, revalidation_due, caqh_id, notes, created_at)` — RLS `enrollments_isolation_all` (same org-isolation).
- **Plan 3a** (3a): `payer_master`, `payer_directory.payer_master_id`, `resolveCoverage`/`resolveClaimRules` (`src/lib/payers/resolve.ts`), the tabbed Payer Profile at `src/app/(app)/payers/[id]/page.tsx` (Portal Access · Covered Codes · Claim Rules), and `src/app/(app)/payers/[id]/_components/`.
- **Foundation:** `public.user_org_id()`, `getStaffContext`/`StaffContext` (`src/lib/auth/context.ts`), `createServerSupabase` (`src/lib/supabase/server.ts`), PHI access layer `src/lib/phi/access.ts` (`readPatient` does `select("*")` + logs `view_chart`), dashboard pattern (`dashboard_stats()` SQL fn → `getDashboardStats` → 3-card grid), test helpers (`asAdmin`/`withClaims`/`resetDb`, `pool`), `npm run db:reset`, serial Vitest (`fileParallelism:false`).

> **Schema note:** `payer_enrollments.payer_id` references `payer_directory(id)` (per-org), NOT `payer_master`. This is intentional — an enrollment is org-specific (this clinic's provider with this clinic's payer record), so it keys on the org's directory row. The Payer Profile is also routed by `payer_directory.id` (`/payers/[id]`), so the Enrolled Providers tab queries enrollments by `payer_id = <that directory id>` directly.

## Decisions (resolved in brainstorming)

1. **Scope:** all four §8.1 items including the patient cross-reference (not deferred to 3c).
2. **Patient↔payer link:** add a nullable `patients.primary_payer_directory_id` FK → `payer_directory(id)`. The free-text `patients.primary_payer` stays for display. The chart resolves the linked directory row's `payer_master_id`, then calls `resolveCoverage`.
3. **Dashboard alert window:** 60 days — count items whose date falls in `current_date .. current_date + 60`, plus anything already overdue (date `< current_date`). Anchored to DB `current_date` (no JS timezone coupling), matching `dashboard_stats()`.

## Architecture

DB schema is essentially complete; this plan is **one small migration + tested libs + thin server components**, following Plans 1–3 exactly: RLS-scoped reads/writes run as `authenticated` via the request-bound `createServerSupabase` client; `org_id` always from `ctx.orgId`/`public.user_org_id()`, never client input; no service role on the tenant path; pages set `export const dynamic = "force-dynamic"`.

### Units

**1. Migration `0012_credentialing.sql`**
- `alter table public.patients add column primary_payer_directory_id uuid references public.payer_directory(id);` (nullable).
- `create function public.credentialing_stats()` — `returns table (licenses_expiring bigint, revalidations_due bigint) language sql security invoker`:
  - `licenses_expiring` = count of `providers` where `deleted_at is null` and `license_expiration is not null` and `license_expiration <= current_date + 60` (includes overdue).
  - `revalidations_due` = count of `payer_enrollments` where `revalidation_due is not null` and `revalidation_due <= current_date + 60` and `status <> 'terminated'`.
  - `security invoker` ⇒ RLS on `providers`/`payer_enrollments` scopes both counts to the caller's org.

**2. `src/lib/providers/mutations.ts`** (all `Pick<SupabaseClient,"from">`, `ctx: StaffContext`):
- `createProvider(client, ctx, input)` — insert into `providers` with `org_id: ctx.orgId`; `input = { name, npi?, licenseType?, licenseNumber?, licenseState?, licenseExpiration? }`; returns `{ id }`.
- `updateProvider(client, ctx, id, input)` — update the org's provider (`.eq("id",id).eq("org_id",ctx.orgId)`).
- `softDeleteProvider(client, ctx, id)` — set `deleted_at = now()`.
- `upsertEnrollment(client, ctx, input)` — insert/update one provider×payer enrollment; `input = { providerId, payerDirectoryId, status, parStatus?, effectiveDate?, terminationDate?, revalidationDue?, caqhId?, notes? }`; `org_id: ctx.orgId`. Upsert on `(org_id, provider_id, payer_id)` — requires a unique index (added in `0012`).

**3. `src/lib/providers/queries.ts`**:
- `listProviders(client)` — `providers` where `deleted_at is null`, ordered by `name`.
- `getProvider(client, id)` — one provider (RLS-scoped).
- `listEnrollmentsForPayer(client, payerDirectoryId)` — `payer_enrollments` for that payer joined to `providers(name)`, for the Enrolled Providers tab.
- `listEnrollmentsForProvider(client, providerId)` — enrollments for a provider (used on the Providers page detail / edit).

**4. `src/lib/dashboard/stats.ts`** — add `CredentialingStats = { licensesExpiring, revalidationsDue }` and `getCredentialingStats(client)` over the `credentialing_stats` RPC (mirrors `getDashboardStats`).

**5. `/providers` page** (`src/app/(app)/providers/page.tsx`) + `actions.ts` + `_components/`:
- Server component lists providers (name, license type/number/state, expiration; flag rows expiring ≤60 days).
- Add-provider form + per-row edit (server actions `createProviderAction`, `updateProviderAction`, `deleteProviderAction`). Admin-gated for mutations (`ctx.role === "admin"`); read open to all staff.
- Nav link "Providers" added to `src/app/(app)/layout.tsx` after "Payers".

**6. Enrolled Providers tab** (`src/app/(app)/payers/[id]/_components/EnrolledProvidersTab.tsx`):
- Rendered on `/payers/[id]` (the Payer Profile is keyed by `payer_directory.id`). Lists `listEnrollmentsForPayer(supabase, id)` rows: provider name, status, par_status, effective/termination/revalidation dates, CAQH ID.
- Add/edit enrollment form (server action `saveEnrollmentAction` in `src/app/(app)/payers/actions.ts`) with a provider picker (the org's providers via `listProviders`). The form needs only the directory id (`[id]`) + the chosen provider + enrollment fields — no `payer_master_id` required, since enrollments key on the directory id. `revalidatePath('/payers/'+id)` after save.

**7. Dashboard cards** (`src/app/(app)/dashboard/page.tsx`):
- Fetch `getCredentialingStats` alongside `getDashboardStats`; render 5 cards (existing 3 + "Licenses expiring soon", "Enrollments due for revalidation"). Adjust grid (e.g. `grid-cols-3` → responsive 5-up / wrap).

**8. Patient chart cross-reference** (`src/app/(app)/patients/[id]/page.tsx`):
- After `readPatient` (unchanged; `select("*")` already returns the new FK), if `patient.primary_payer_directory_id` is set: fetch that directory row's `payer_master_id`; if present, `resolveCoverage(supabase, masterId)` and render a compact covered-codes summary section (CPT · covered · prior-auth · provenance) with a link to the full Payer Profile.
- A small "Link payer" form (server action in `patients/actions.ts`) sets `patients.primary_payer_directory_id` from the org's `payer_directory` list. The coverage lookup is payer **reference data** — it does NOT go through `access.ts` (only the patient read does).

## Data Flow

- **Providers page:** `getStaffContext` → `listProviders(supabase)` (RLS-scoped) → table; form submit → action → `createProvider`/`updateProvider`/`softDeleteProvider` → `revalidatePath('/providers')`.
- **Enrolled Providers tab:** Payer Profile loads → `listEnrollmentsForPayer(supabase, id)` → tab; enrollment form → `saveEnrollmentAction` → `upsertEnrollment` → `revalidatePath('/payers/'+id)`.
- **Dashboard:** page → `getDashboardStats` + `getCredentialingStats` (two RPCs, both `security invoker`, RLS-scoped) → 5 cards.
- **Patient cross-ref:** chart load → `readPatient` (logs `view_chart`) → if linked, directory→master→`resolveCoverage` → summary section; link form → action → update `patients.primary_payer_directory_id`.

## Error Handling

- Every lib mutation/query checks the supabase `error` and throws `Error("<fn> failed: <message>")` (matches Plan 3 libs).
- Server actions resolve `ctx` or `redirect("/onboarding")`; mutations additionally require `ctx.role === "admin"` (throw/redirect otherwise) — reads remain open to all staff.
- RLS is the security boundary: cross-org reads/writes are denied at the DB regardless of input. Tests assert this.

## Testing

TDD against the established hosted-Supabase harness (serial, `.env.local` auto-loaded, `npm run db:reset`).

- `tests/db/providers.test.ts` — `createProvider`/`updateProvider`/`softDeleteProvider`/`upsertEnrollment` write org-scoped rows; cross-org isolation (org B cannot read/update org A's providers or enrollments); `listProviders` excludes soft-deleted; `upsertEnrollment` updates in place on `(org_id, provider_id, payer_id)`.
- `tests/db/credentialing-stats.test.ts` — seed providers/enrollments with dates inside/outside the 60-day window and overdue; assert `credentialing_stats()` counts, and that it is org-scoped (RLS) via an authenticated client.
- `tests/lib/providers-actions-smoke.test.ts` — the providers + payers action modules export the expected server actions.
- Final gate: `npx tsc --noEmit`, `npm run build`, `npm test` (full suite green).

## Out of Scope (by design)

- Consent-capture admin UI, staff/role management → **Plan 3c**.
- Email/cron alerts for expiring licenses/revalidations → **Plan 4** (the dashboard cards surface the counts in-app now).
- Any claim-scrubbing/837P generation (explicit §8.3 scope note — Coverlog is a lookup/checklist tool).
- Office Ally / crowd-sourcing.

## File Structure

- `supabase/migrations/0012_credentialing.sql`
- `src/lib/providers/mutations.ts`, `src/lib/providers/queries.ts`
- `src/lib/dashboard/stats.ts` (extend)
- `src/app/(app)/providers/page.tsx`, `.../providers/actions.ts`, `.../providers/_components/*`
- `src/app/(app)/payers/[id]/_components/EnrolledProvidersTab.tsx`, `src/app/(app)/payers/actions.ts` (extend), `src/app/(app)/payers/[id]/page.tsx` (render tab)
- `src/app/(app)/patients/[id]/page.tsx` (extend), `src/app/(app)/patients/actions.ts` (extend)
- `src/app/(app)/layout.tsx` (Providers nav link)
- `src/app/(app)/dashboard/page.tsx` (5 cards)
- `tests/db/providers.test.ts`, `tests/db/credentialing-stats.test.ts`, `tests/lib/providers-actions-smoke.test.ts`
