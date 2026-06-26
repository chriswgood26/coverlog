# Coverlog Mockup Dashboard — Design

**Status:** Approved direction (2026-06-26). **Plan C** of the UI initiative (A restyle ✅ → B provider status/specialty ✅ → **C mockup dashboard (this doc)** → D nav rename).

## Goal

Reshape the dashboard to the CredFlow mockup: a credentialing-forward stat row (Total Providers · Expiring Soon · Pending Review · Flagged), the existing eligibility stat row, and two list panels — **Pending Verifications** (patients pending eligibility) and **Expiring Credentials** (provider licenses expiring) — under the greeting.

## Decisions (resolved in brainstorming)

1. **Pending Verifications PHI:** list pending patients with **name + payer + member ID** (most faithful), each linking to the chart; the read goes through the PHI access layer (`access.ts`) and **logs a `list_view`** access_log row. The dashboard is therefore a PHI surface — every load writes one access_log entry (accepted).
2. **Card set:** keep **both** — the mockup's 4 credentialing cards AND the existing 3 eligibility cards.
3. **Stats source:** extend the existing `credentialing_stats()` (SECURITY INVOKER, session-scoped — already what the dashboard calls) with the new counts. The Plan 4 digest's `org_alert_counts` (SECURITY DEFINER) is a separate function and is NOT touched.
4. **Card semantics:** Total Providers = non-deleted providers; Expiring Soon = licenses ≤60d (existing `licenses_expiring`); Pending Review = providers `status='pending'`; Flagged = providers `status='flagged'`.

## Foundation this builds on (already merged)

- `credentialing_stats()` (migration `0012`, SECURITY INVOKER) → `(licenses_expiring, revalidations_due)`; `dashboard_stats()` (`0009`) → `(verified_today, due_this_week, needs_attention)`. `src/lib/dashboard/stats.ts`: `getDashboardStats`/`getCredentialingStats` + `DashboardStats`/`CredentialingStats`.
- Plan B (`0014`): `providers.status` (`active`/`pending`/`flagged`, default active) + `providers.specialty`.
- `providers.license_expiration date` (nullable); providers org-isolation RLS (`0003`).
- `patients` (org-RLS): `status` (`verified`/`pending`/`inactive`), `name`, `primary_payer`, `member_id`, `deleted_at`.
- `src/lib/phi/access.ts`: module-private `logAccess(client, ctx, { action, patient_id?, patient_ids?, query_context? })` → `access_log`; `readPatient` (logs `view_chart`), `listPatients`/`listCheckHistory`/`listOrgConsents` (logged). `PhiContext = { orgId, staffId }` (`StaffContext` is compatible).
- `src/lib/providers/queries.ts`: `listProviders`, `listExpiringCredentials` does NOT exist yet. `src/app/(app)/dashboard/page.tsx` (Plan A): greeting + summary + 5 tinted cards. UI primitives: `@/components/ui/{Card,Badge}`, `@/lib/ui`.
- Test harness: `tests/db/credentialing-stats.test.ts` (Plan 4, real-auth, calls the RPC via an authenticated client); `tests/db/helpers.ts`.

## Architecture

One migration (`0015`, extend `credentialing_stats`) + two new read functions (one logged PHI read in `access.ts`, one plain provider read in `queries.ts`) + a dashboard page rewrite. The dashboard runs as the logged-in user (SECURITY INVOKER + RLS scope everything to the org). No service role; no change to the email digest, providers page, or payer profile.

### Unit 1 — Migration `0015_dashboard_stats_v2.sql`
`create or replace function public.credentialing_stats()` returning the existing two columns plus three new ones, all org-scoped via RLS (SECURITY INVOKER), windowed to `current_date`:
```sql
create or replace function public.credentialing_stats()
  returns table (licenses_expiring bigint, revalidations_due bigint,
                 total_providers bigint, pending_review bigint, flagged bigint)
  language sql security invoker as $$
  select
    (select count(*) from public.providers
       where deleted_at is null and license_expiration is not null
         and license_expiration <= current_date + 60),
    (select count(*) from public.payer_enrollments
       where revalidation_due is not null and revalidation_due <= current_date + 60
         and status <> 'terminated'),
    (select count(*) from public.providers where deleted_at is null),
    (select count(*) from public.providers where deleted_at is null and status = 'pending'),
    (select count(*) from public.providers where deleted_at is null and status = 'flagged');
$$;
```
(Column order: the two existing columns stay first so the shape is a superset.)

### Unit 2 — Stats lib
`src/lib/dashboard/stats.ts`: `CredentialingStats` gains `totalProviders: number; pendingReview: number; flagged: number`; `getCredentialingStats` maps `total_providers`/`pending_review`/`flagged` (`Number(... ?? 0)`). `getDashboardStats` unchanged.

### Unit 3 — Panel reads
- `src/lib/phi/access.ts` — `listPendingVerifications(client, ctx: PhiContext): Promise<PendingVerification[]>`: selects `patients` where `status='pending' and deleted_at is null` (`id, name, primary_payer, member_id`), ordered by `next_due` asc nulls last; then `logAccess(client, ctx, { action: "list_view", patient_ids: rows.map(r=>r.id), query_context: "dashboard_pending" })`. `PendingVerification = { id: string; name: string; primary_payer: string | null; member_id: string | null }`. Lives in access.ts because it surfaces patient PHI and must be logged.
- `src/lib/providers/queries.ts` — `listExpiringCredentials(client): Promise<ExpiringCredential[]>`: providers where `deleted_at is null and license_expiration is not null and license_expiration <= current_date + 60`, ordered by `license_expiration` asc, selecting `id, name, license_type, license_expiration`. `ExpiringCredential = { id: string; name: string; license_type: string | null; license_expiration: string }`. RLS-scoped; provider data is not PHI, so no access log.

### Unit 4 — Dashboard page
`src/app/(app)/dashboard/page.tsx` (rewrite, `force-dynamic`, resolves `getStaffContext`):
- Fetch (Promise.all): `getDashboardStats`, `getCredentialingStats`, staff name, `listPendingVerifications(supabase, ctx)`, `listExpiringCredentials(supabase)`.
- Greeting `Good {part}, {name}` + summary: `{pending.length} eligibility verifications pending · {cred.licensesExpiring} credentials expiring soon`.
- **Credentialing** row (4 tinted cards): Total Providers (`cred.totalProviders`), Expiring Soon (`cred.licensesExpiring`), Pending Review (`cred.pendingReview`), Flagged (`cred.flagged`). **Eligibility** row (3 cards): Verified today, Due this week, Needs attention. Small uppercase section labels above each row.
- Two `Card` panels (`lg:grid-cols-2`): **Pending Verifications** — for each pending patient a row: `<Link href={`/patients/${p.id}`}>` name + payer + member ID + a `<Badge value="pending" />`; empty → "No pending verifications." **Expiring Credentials** — for each: provider name + license_type + a "N days left" / "expired today"/"overdue" label computed from `license_expiration` vs today; empty → "No credentials expiring."

## Data Flow

Dashboard load → (SECURITY INVOKER RPCs + RLS reads, all org-scoped) stats + pending patients (logs `list_view`) + expiring providers → greeting, two card rows, two panels. Click a pending patient → `/patients/[id]` (chart read logs `view_chart`).

## Error Handling

Lib functions check the supabase `error` and throw `Error("<fn> failed: <message>")` (matches the codebase). `listPendingVerifications` logs access via the existing `logAccess` (which throws if the audit insert fails — audit must be reliable). The page resolves `ctx` (the `(app)` layout already guarantees it / redirects); if `ctx` were null the page skips the PHI panel rather than calling the logged read without a context.

## Testing

- `tests/db/credentialing-stats.test.ts` (extend): seed providers with mixed `status` (active/pending/flagged) + a soft-deleted one; assert `getCredentialingStats` returns the correct `totalProviders` (excludes deleted), `pendingReview`, `flagged`, alongside the existing `licensesExpiring`/`revalidationsDue`; still org-scoped (RLS).
- `tests/db/dashboard-panels.test.ts` (new, real-auth): `listPendingVerifications` returns only `status='pending'` non-deleted patients with name/payer/member_id, writes an `access_log` `list_view` row (assert via asAdmin), and is org-scoped (org B's pending patient not returned for org A). `listExpiringCredentials` returns providers with `license_expiration ≤ current_date+60`, excludes far-future and deleted, ordered ascending.
- Gate: `npx tsc --noEmit`, `npm run build` (dashboard route present), `npm test` green.

## Out of Scope (this plan)

- Nav/IA rename (Insurance Eligibility / Credentialing) → **Plan D**.
- Adding the new flagged/pending counts to the email digest (`org_alert_counts`) → possible later tweak, not here.
- Any provider/patient workflow changes; the panels are read-only views of existing data.
- Pagination of the panels (show all pending / all expiring; these are small per-org sets).

## File Structure

- `supabase/migrations/0015_dashboard_stats_v2.sql` — create
- `src/lib/dashboard/stats.ts` — modify (`CredentialingStats` + `getCredentialingStats`)
- `src/lib/phi/access.ts` — add `listPendingVerifications`
- `src/lib/providers/queries.ts` — add `listExpiringCredentials`
- `src/app/(app)/dashboard/page.tsx` — rewrite
- `tests/db/credentialing-stats.test.ts` — extend; `tests/db/dashboard-panels.test.ts` — create
