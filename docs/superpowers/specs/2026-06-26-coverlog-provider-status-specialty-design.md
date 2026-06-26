# Coverlog Provider Status + Specialty + Search — Design

**Status:** Approved direction (2026-06-26). **Plan B** of the UI initiative (A visual restyle ✅ → **B provider status/specialty (this doc)** → C mockup dashboard → D nav rename).

## Goal

Add the provider credentialing fields the CredFlow mockup shows but the schema lacks: a provider **status** (active / pending / flagged) and a **specialty**, surfaced on the Providers page as a status pill + Specialty column, with a "Search by name, NPI, or specialty" bar. This unblocks Plan C's Flagged / Pending-Review dashboard metrics.

## Decisions (resolved in brainstorming)

1. **Status editing:** set on create (default `active`) AND changeable per-row by admins (a `select + Set` form per row, like the staff role toggle). Real credentialing flips active↔pending↔flagged over time.
2. **Search:** server-side `?q=` GET filter — the page filters `listProviders` by name/NPI/specialty (case-insensitive). No client component, works without JS.
3. **Specialty:** free text (nullable). No fixed taxonomy.
4. **Status values:** exactly `active` | `pending` | `flagged`, DB `check` constraint, default `active`. No "reason" field for flagged (YAGNI).

## Foundation this builds on (already merged)

- `public.providers(id, org_id, name, npi, license_type, license_number, license_state, license_expiration, created_at, deleted_at)` — RLS `providers_isolation_all` (`for all` org-scoped). Migrations through `0013`.
- `src/lib/providers/queries.ts`: `Provider` type, `listProviders(client)` (deleted_at null, order by name), `getProvider`, enrollment queries. `src/lib/providers/mutations.ts`: `ProviderInput`, `providerColumns` (partial-update helper that omits undefined keys), `createProvider(client, ctx, input & { name })`, `updateProvider(client, ctx, id, input)`, `softDeleteProvider`.
- `src/app/(app)/providers/page.tsx` (restyled in Plan A: PageHeader + `tableWrap` table, `Badge`, `btnDangerText` Remove, admin gate) + `_components/AddProviderForm.tsx` + `actions.ts` (`createProviderAction`, `deleteProviderAction`, admin-gated via `adminCtxOrRedirect`).
- UI primitives: `@/lib/ui` constants, `@/components/ui/{Badge,PageHeader}`; `Badge` `statusColor` already maps `active`→emerald, `pending`→amber, `flagged`→red.
- Test harness: `tests/db/providers.test.ts` (real-auth + cross-org), `tests/lib/providers-actions-smoke.test.ts`; `npm run db:reset`; serial Vitest.

## Architecture

One small migration + additive lib changes + a providers-page pass. RLS-scoped throughout; `org_id` from `ctx`; status mutations admin-gated at the action layer (matches existing provider mutations). No change to enrollments, the payer profile, or the dashboard.

### Unit 1 — Migration `0014_provider_status_specialty.sql`
```sql
alter table public.providers
  add column status text not null default 'active' check (status in ('active','pending','flagged'));
alter table public.providers add column specialty text;
```
Existing rows default to `active`. No RLS/grant change. (Plan C will later count `status='flagged'` / `'pending'`; this plan does not touch `credentialing_stats`/`org_alert_counts`.)

### Unit 2 — Libs
- `src/lib/providers/queries.ts`:
  - `Provider` type adds `status: string` and `specialty: string | null`.
  - All provider `select` strings add `status, specialty`.
  - `listProviders(client, opts: { search?: string } = {})`: after the `deleted_at is null` + `order("name")` query, when `opts.search` is a non-empty string, apply `.or("name.ilike.%<q>%,npi.ilike.%<q>%,specialty.ilike.%<q>%")` where `<q>` is the search term **sanitized** by removing the PostgREST-`or()` grammar characters `, ( ) * %` and trimming (so a stray comma/paren can't break or inject into the filter). Empty-after-sanitize → no filter.
- `src/lib/providers/mutations.ts`:
  - `ProviderInput` adds `status?: "active" | "pending" | "flagged"` and `specialty?: string`.
  - `providerColumns` maps `status`→`status`, `specialty`→`specialty` (same undefined-omitting pattern).
  - `createProvider` and `updateProvider` need no signature change (they already spread `providerColumns`).

### Unit 3 — Actions + UI
- `src/app/(app)/providers/actions.ts`:
  - `createProviderAction` also reads `specialty` (trim→undefined) and `status` (default `"active"`, validated to the three values).
  - New `setProviderStatusAction(formData)` — admin-gated via the existing `adminCtxOrRedirect`; reads `id` + `status` (validated), calls `updateProvider(supabase, ctx, String(id), { status })`, `revalidatePath("/providers")`.
- `src/app/(app)/providers/_components/AddProviderForm.tsx`: add a `name="specialty"` input and a `name="status"` `<select>` (options active/pending/flagged, default active).
- `src/app/(app)/providers/page.tsx`:
  - Read `searchParams` (`Promise<{ q?: string }>`); pass `{ search: q }` to `listProviders`.
  - A search `<form method="get">` with `name="q"` (defaultValue = current q) + a Search button, above the table.
  - Table columns: **Name · NPI · Specialty · License · State · Expires · Status · (actions)**. Status rendered as `<Badge value={p.status} />`. Specialty shows `p.specialty ?? "—"`.
  - Actions column (admin only): a `setProviderStatusAction` form — hidden `id` + `<select name="status" defaultValue={p.status}>` + a small "Set" button — followed by the existing Remove form. Non-admins: no actions column content.
  - Preserve `force-dynamic`, the `getStaffContext`/redirect guard, `isAdmin` gate on AddProviderForm + actions, and the existing license columns/data.

## Data Flow

- **List/search:** `/providers?q=foo` → page reads `q` → `listProviders(supabase, { search: q })` (RLS-scoped) → table.
- **Create:** AddProviderForm → `createProviderAction` (specialty + status) → `createProvider` → revalidate.
- **Status change:** per-row form → `setProviderStatusAction` (admin) → `updateProvider({ status })` → revalidate.

## Error Handling

- Lib fns keep the `Error("<fn> failed: <message>")` convention. `setProviderStatusAction` validates `status` ∈ the three values (falls back to a thrown error or ignores invalid — validate and default to no-op-safe; the DB check is the backstop). Admin gate via `adminCtxOrRedirect` (redirect non-admins). The DB `check` constraint rejects any invalid status as defense-in-depth.

## Testing

- `tests/db/providers.test.ts` (extend): `createProvider` defaults `status='active'`; passing `status`/`specialty` persists them; `updateProvider(..., { status: 'flagged' })` flips it; an invalid status insert is rejected by the check constraint; `listProviders({ search })` matches by name, NPI, and specialty (case-insensitive) and excludes non-matches; existing cross-org isolation still holds.
- `tests/lib/providers-actions-smoke.test.ts` (extend): the providers actions module also exports `setProviderStatusAction`.
- Gate: `npx tsc --noEmit`, `npm run build` (providers route present), `npm test` green.

## Out of Scope (this plan)

- Dashboard Flagged / Pending-Review metrics + Pending Verifications panel → **Plan C** (uses this status field).
- A dedicated provider edit page (only status is per-row editable here; name/license/specialty edited via re-add or a future edit page).
- Nav/IA rename → **Plan D**. Provider-status-driven filtering of enrollments or the payer profile.

## File Structure

- `supabase/migrations/0014_provider_status_specialty.sql` — create
- `src/lib/providers/queries.ts`, `src/lib/providers/mutations.ts` — modify
- `src/app/(app)/providers/{page.tsx,actions.ts,_components/AddProviderForm.tsx}` — modify
- `tests/db/providers.test.ts`, `tests/lib/providers-actions-smoke.test.ts` — extend
