# Coverlog Consent Admin + Staff Management + Minimal Auth UI — Design

**Status:** Approved (2026-06-25)
**Plan:** 3c of the Module 8 arc (3a payer intelligence ✅ → 3b credentialing ✅ → **3c consent admin + staff mgmt + auth UI**).

## Goal

Make the app usable end-to-end in a browser and complete the admin/compliance surface: a minimal email+password sign-in/sign-up/sign-out flow; admin management of existing staff (roles + activate/deactivate, with a last-admin safety guard); and 42 CFR Part 2 consent administration (per-patient grant/revoke on the chart, audited to `disclosure_log`, plus a read-only org-wide consents overview).

## Decisions (resolved in brainstorming)

1. **Auth UI:** include minimal `/sign-in` + `/sign-up` (Supabase Auth, email+password only — no magic links/email) + a sign-out action. This unblocks reaching `/admin` in a browser; the app currently has no sign-in page (onboarding redirects to a non-existent `/sign-in`).
2. **Staff scope:** manage EXISTING staff only — list, change role (admin↔specialist), deactivate (soft-delete) / reactivate. NO staff invitation (auth-user creation + invite/link flow) — deferred to a later plan; it needs an invite-acceptance/link flow and (for delivery) SES from Plan 4.
3. **Consent admin:** grant/revoke live per-patient on the chart (where the consent banner already is); each grant/revoke writes a `disclosure_log` row (Part 2 accounting) via the existing `logDisclosure`. A read-only `/admin` consents overview lists the org's consents.

## Foundation this builds on (already merged)

- **Tables (all exist, org-isolation RLS):**
  - `public.patient_consents(id, org_id, patient_id, consent_type, scope, granted_at, expires_at, revoked_at, document_ref, created_by→staff(id), created_at)` — RLS `consents_isolation_all` (`for all` org-scoped). Migration `0004`.
  - `public.disclosure_log(id, org_id, patient_id, actor_staff_id, action, purpose, disclosed_to, occurred_at, detail jsonb)` — append-only (insert+select RLS; UPDATE/DELETE blocked by `audit_append_only` trigger). Migration `0004`.
  - `public.staff(id, org_id, user_id unique, name, email, role ∈ {admin,specialist} default specialist, created_at, deleted_at)` — RLS `staff_isolation_all` (`for all` org-scoped). Migration `0001`.
- **Libs/helpers:** `getStaffContext`/`StaffContext` (`{orgId, staffId, role}`); `createServerSupabase` (SSR client, manages auth cookies; `setAll` works in server actions, no-ops in server components — session refresh handled by `proxy.ts`); `src/lib/phi/access.ts` (`readPatient` logs `view_chart`; private `logAccess` writes `access_log`); `src/lib/phi/consent.ts` (`hasValidConsent`); `src/lib/phi/disclosure.ts` (`logDisclosure(client, ctx, entry)` → append `disclosure_log`); `createOrgWithFirstAdmin` (onboarding, idempotent). Test harness: `tests/db/helpers.ts` (`pool`, `withClaims`, `asAdmin`, `resetDb`), real-auth via `admin.auth.admin.createUser` + `signInWithPassword`; `npm run db:reset`; serial Vitest.
- **No migration required:** `patient_consents`/`staff`/`disclosure_log` already carry every field this plan writes (`disclosure_log.action` is free text → `"consent_granted"`/`"consent_revoked"`). Confirm during planning; if confirmed, Plan 3c adds NO migration.

## Architecture

Tested libs + thin server components, following Plans 1–3 exactly: RLS-scoped reads/writes as `authenticated` via the request-bound `createServerSupabase`; `org_id`/`staffId` from `ctx`, never client input; mutations admin-gated at the server-action layer (RLS remains the tenant boundary); pages set `export const dynamic = "force-dynamic"`. No service role anywhere in this plan.

### Units

**1. Auth UI**
- `src/app/sign-in/page.tsx` + `actions.ts`: email+password form → `signInAction` calls `supabase.auth.signInWithPassword({email,password})` (SSR client sets cookies). Success → `redirect("/dashboard")` (the `(app)` layout bounces to `/onboarding` if the user has no staff row). Failure → re-render with an error message (via `?error=` search param or a returned state).
- `src/app/sign-up/page.tsx` + `actions.ts`: `signUpAction` calls `supabase.auth.signUp({email,password})`, then attempts `signInWithPassword`; if the project requires email confirmation (no session returned), redirect to a "check your email" state rather than erroring.
- Sign-out: `signOutAction` (a server action) → `supabase.auth.signOut()` → `redirect("/sign-in")`. A "Sign out" button added to the `(app)` layout nav.
- These actions are thin wrappers over Supabase Auth; correctness is covered by a smoke test (module exports) — cookie/redirect behavior is not unit-testable without a request.

**2. Staff management**
- `src/lib/staff/queries.ts`: `listStaff(client): Promise<StaffRow[]>` — all staff in the org (incl. `role`, `deleted_at`), ordered by `name`. `StaffRow = { id, name, email, role, user_id, deleted_at }`.
- `src/lib/staff/mutations.ts`: `setStaffRole(client, ctx, staffId, role)`, `deactivateStaff(client, ctx, staffId)` (sets `deleted_at = now()`), `reactivateStaff(client, ctx, staffId)` (sets `deleted_at = null`). **Last-admin guard:** `setStaffRole(..., "specialist")` and `deactivateStaff` must throw if the target is the only active admin (count active admins where `deleted_at is null and role='admin'`; refuse if removing/demoting the last one). Guard lives in the mutation so it's lib-testable.
- `src/app/(app)/admin/staff/page.tsx` + `src/app/(app)/admin/actions.ts`: admin-only (page redirects non-admins to `/dashboard`). Lists staff with a role toggle and activate/deactivate buttons. Actions `setStaffRoleAction`, `deactivateStaffAction`, `reactivateStaffAction` (admin-gated; surface the last-admin guard's error).

**3. Consent admin (libs)**
- Extend `src/lib/phi/consent.ts`:
  - `grantConsent(client, ctx, input)` where `input = { patientId, consentType, scope?, expiresAt?, documentRef? }` → insert `patient_consents` (`org_id`, `patient_id`, `consent_type`, `scope`, `granted_at = now()`, `expires_at`, `document_ref`, `created_by = ctx.staffId`); then `logDisclosure(client, ctx, { action: "consent_granted", patient_id, detail: { consent_type } })`.
  - `revokeConsent(client, ctx, consentId)` → update `patient_consents set revoked_at = now()` for the org's row; then `logDisclosure(client, ctx, { action: "consent_revoked", patient_id, detail: { consent_id } })` (fetch the row's `patient_id` to log it).
  - `listConsentsForPatient(client, patientId): Promise<ConsentRow[]>` — the patient's consents (newest first), for the chart.
  - `ConsentRow = { id, consent_type, scope, granted_at, expires_at, revoked_at, document_ref }`.
- The existing `hasValidConsent` is unchanged.

**4. Consent UI on the patient chart**
- `src/app/(app)/patients/[id]/page.tsx`: add a "Consents" section listing `listConsentsForPatient` rows (type, scope, granted/expires/revoked, status) with a Revoke button per active consent, plus a grant-consent form. Server actions `grantConsentAction`, `revokeConsentAction` in `src/app/(app)/patients/actions.ts` (reuse `ctxOrRedirect`; open to all staff — consent capture is front-desk work, consistent with patient writes being non-admin). `revalidatePath` the chart.

**5. Org consents overview (logged read) + /admin overview page**
- `src/lib/phi/access.ts`: add `listOrgConsents(client, ctx): Promise<OrgConsentRow[]>` — selects `patient_consents` joined to `patients(name)` (RLS-scoped to the org), then logs a `list_view` access_log entry with the surfaced `patient_ids` (reuses the private `logAccess`). Lives in access.ts because it surfaces patient names (PHI) and must be logged. `OrgConsentRow = { id, patient_id, patient_name, consent_type, granted_at, expires_at, revoked_at }`.
- `src/app/(app)/admin/page.tsx`: admin-only read-only overview table of `listOrgConsents`. Links to `/admin/staff`.

**6. Nav**
- `src/app/(app)/layout.tsx`: add an "Admin" link (visible to admins) and a "Sign out" button. The layout already resolves `ctx`; gate the Admin link on `ctx.role === "admin"`.

## Data Flow

- **Sign-in:** `/sign-in` form → `signInAction` (SSR client sets cookies) → `/dashboard`; `proxy.ts` refreshes session each request; `(app)` layout `getStaffContext` → `/onboarding` if unlinked.
- **Staff:** `/admin/staff` → `listStaff` → table; action → admin check → `setStaffRole`/`deactivateStaff`/`reactivateStaff` (last-admin guard) → `revalidatePath("/admin/staff")`.
- **Consent (chart):** chart → `readPatient` (logs `view_chart`) + `listConsentsForPatient` → section; grant/revoke action → `grantConsent`/`revokeConsent` (writes consent row + `disclosure_log`) → `revalidatePath` chart.
- **Consent overview:** `/admin` → `listOrgConsents` (logs `list_view`) → table.

## Error Handling

- Lib mutations/queries check the supabase `error` and throw `Error("<fn> failed: <message>")` (matches Plans 1–3).
- Last-admin guard throws a clear `Error("cannot remove the last admin")`; the admin actions let it surface (re-render with the message).
- Auth actions: on Supabase auth error, re-render the page with the error message; never throw raw.
- Admin pages redirect non-admins to `/dashboard`; all server actions resolve `ctx` or `redirect("/onboarding")`, and admin actions additionally require `ctx.role === "admin"`.

## Testing

TDD against the hosted-Supabase harness (serial, `.env.local`, `npm run db:reset`).

- `tests/db/staff-admin.test.ts` — `setStaffRole`/`deactivateStaff`/`reactivateStaff` write org-scoped changes; **last-admin guard** (demoting/deactivating the only active admin throws; with two admins it succeeds); cross-org isolation (org B cannot modify org A's staff).
- `tests/db/consent-admin.test.ts` — `grantConsent` inserts a `patient_consents` row AND a `disclosure_log` `consent_granted` row; `revokeConsent` sets `revoked_at` AND logs `consent_revoked`; `hasValidConsent` flips false after revoke; `listConsentsForPatient` returns rows; `listOrgConsents` returns joined rows AND writes an `access_log` `list_view` entry.
- `tests/lib/admin-auth-smoke.test.ts` — the auth, staff-admin, and consent action modules export their server actions.
- Final gate: `npx tsc --noEmit`, `npm run build`, `npm test` (full suite green).

## Out of Scope (by design)

- Staff invitation (service-role auth-user creation + invite token + acceptance/link flow) → later plan.
- Email/magic-link auth, password reset → later; SES delivery → Plan 4.
- Consent document upload/storage (only `document_ref` text is captured).
- Editing consents (only grant + revoke; correcting a mistake = revoke + re-grant).

## File Structure

- `src/app/sign-in/{page.tsx,actions.ts}`, `src/app/sign-up/{page.tsx,actions.ts}`, `src/app/(app)/_actions/signout.ts` (or co-located) — auth UI.
- `src/lib/staff/{queries.ts,mutations.ts}` — staff management libs.
- `src/app/(app)/admin/{page.tsx,actions.ts}`, `src/app/(app)/admin/staff/page.tsx` — admin pages.
- `src/lib/phi/consent.ts` (extend), `src/lib/phi/access.ts` (extend: `listOrgConsents`).
- `src/app/(app)/patients/{[id]/page.tsx,actions.ts}` (extend) — chart consent UI.
- `src/app/(app)/layout.tsx` (Admin link + Sign out).
- Tests: `tests/db/staff-admin.test.ts`, `tests/db/consent-admin.test.ts`, `tests/lib/admin-auth-smoke.test.ts`.
