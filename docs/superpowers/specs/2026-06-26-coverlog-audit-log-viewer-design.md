# Coverlog Audit-Log Viewer — Design

**Status:** Approved direction (2026-06-26).

## Goal

Give org admins an in-app, read-only view of their org's audit trail: the `access_log` (who read which chart/list, when — internal PHI-access audit) and the `disclosure_log` (consent grants/revokes + disclosures, with purpose / disclosed-to — the 42 CFR Part 2 accounting of disclosures). Today these are append-only and write-only from the UI; this adds a viewer.

## Decisions (resolved in brainstorming)

1. **Both logs** — two sections under `/admin/audit` (Access Log + Disclosure Log).
2. **Show patient names** (joined), and link single-patient rows to the chart — so the audit is actually usable. Because this surfaces PHI, viewing the page writes **one meta `access_log` "audit_view"** entry (`query_context: "admin_audit"`), consistent with the dashboard pending-panel.
3. **v1 = recent entries, newest-first, capped (~100 each), no filters.** Date/patient/actor filters are a clean follow-up.
4. **Admin-gated**, under `/admin`. **No migration, no service role** — an admin reads their own org's logs via the normal RLS client.

## Foundation this builds on (already merged)

- `access_log` (migration `0004`, partitioned by `occurred_at`, forced RLS, `select using (org_id = user_org_id())`): `id, org_id, actor_staff_id → staff(id), action, patient_id → patients(id), patient_ids uuid[], query_context, occurred_at, detail`. Action vocab in use: `view_chart`, `list_view`, `view_check_history` (+ the new `audit_view`).
- `disclosure_log` (`0004`, append-only, `select using (org_id = user_org_id())`): `id, org_id, patient_id → patients(id), actor_staff_id → staff(id), action, purpose, disclosed_to, occurred_at, detail`. Action vocab: `consent_granted`, `consent_revoked`.
- Both have org-scoped `select` RLS, so the request-bound `authenticated` client reads only the caller's org. Both are append-only (insert+select; `audit_append_only` trigger blocks UPDATE/DELETE).
- `src/lib/phi/access.ts`: module-private `logAccess(client, ctx, { action, patient_id?, patient_ids?, query_context? })` (throws if the audit insert fails); `PhiContext = { orgId, staffId }`. `src/app/(app)/admin/page.tsx` (admin overview, `ctx.role !== "admin"` redirect) + `admin/staff`. UI primitives `@/components/ui/{Card,Badge}`, `@/lib/ui`.
- Test harness: `tests/db/helpers.ts`; real-auth pattern (`admin.auth.admin.createUser` + `signInWithPassword`, delete by captured id).

## Architecture

One new logged read in the PHI access layer + one new admin page + a link from `/admin`. RLS scopes everything to the org; no service role; no schema change.

### Unit 1 — `listAuditTrail` (logged read) in `src/lib/phi/access.ts`
`listAuditTrail(client, ctx: PhiContext): Promise<AuditTrail>`:
- Fetch in parallel: `access_log` (`id, occurred_at, action, actor_staff_id, patient_id, patient_ids, query_context`) and `disclosure_log` (`id, occurred_at, action, actor_staff_id, patient_id, purpose, disclosed_to`), each `.order("occurred_at", { ascending: false }).limit(100)` (RLS scopes to the org).
- Collect referenced `actor_staff_id`s and patient ids (`patient_id` + flattened `patient_ids[]`); batch-resolve names via `staff.select("id,name").in("id", …)` and `patients.select("id,name").in("id", …)` (both RLS-scoped); build `Map`s. (Done in JS rather than PostgREST embeds — `patient_ids` is an array with no embeddable FK, and `access_log` is partitioned.)
- Write **one** meta entry: `logAccess(client, ctx, { action: "audit_view", patient_ids: [...allPatientIds], query_context: "admin_audit" })`. (Throws if it fails — audit reliability.)
- Return `{ access: AccessEntry[], disclosures: DisclosureEntry[] }`:
  - `AccessEntry = { id, occurred_at, action, actor_name, patient_id: string|null, patient_label }` where `patient_label` = the patient's name (single `patient_id`), or `"{n} patients"` (when `patient_ids[]` is set), or `"—"`.
  - `DisclosureEntry = { id, occurred_at, action, actor_name, patient_id: string|null, patient_name, purpose, disclosed_to }`.
  - Unknown staff/patient → `"—"`.

### Unit 2 — `/admin/audit` page
`src/app/(app)/admin/audit/page.tsx` (`force-dynamic`, resolves `getStaffContext`, `if (!ctx) redirect("/onboarding")`, `if (ctx.role !== "admin") redirect("/dashboard")`):
- `const trail = await listAuditTrail(supabase, ctx)`.
- `PageHeader title="Audit Log" backHref="/admin"`.
- **Access Log** `Card`: table — When (`occurred_at`, formatted date-time) · Actor (`actor_name`) · Action (`<Badge>` or plain) · Patient(s) (`patient_id` → `<Link href="/patients/{id}">{patient_label}</Link>`, else plain `patient_label`). Empty → "No access events.".
- **Disclosure Log** `Card`: table — When · Actor · Action · Patient (linked when `patient_id`) · Purpose (`purpose ?? "—"`) · Disclosed to (`disclosed_to ?? "—"`). Empty → "No disclosures.".
- Add a link from `src/app/(app)/admin/page.tsx` (next to the existing Staff link): `<Link href="/admin/audit">Audit Log</Link>`.

## Data Flow

`/admin/audit` (admin) → `listAuditTrail` (RLS-scoped reads of access_log + disclosure_log + name lookups; writes one `audit_view` access_log row) → two tables. Patient links → `/patients/[id]` (chart read logs `view_chart`).

## Error Handling

`listAuditTrail` propagates a thrown `logAccess` failure (audit must be reliable). The two log reads tolerate empty data (`?? []`). The page enforces admin (redirect non-admins) and a ctx guard. No new mutation paths.

## Testing

- `tests/db/audit-viewer.test.ts` (real-auth): seed ORG_A with staff (the signed-in actor), patients (P1, P2), an `access_log` `view_chart` for P1 and a `list_view` with `patient_ids=[P1,P2]`, and a `disclosure_log` `consent_granted` for P1 (purpose/disclosed_to); seed an ORG_B `access_log` row. Call `listAuditTrail(userClient, ctx_A)` and assert: access entries include the view_chart (patient_label = P1's name) and the list_view (patient_label = "2 patients") with the actor's name; disclosures include the consent_granted with patient_name + purpose + disclosed_to; newest-first ordering; ORG_B's row is absent (RLS); and a new `access_log` row with `action='audit_view'` + `query_context='admin_audit'` was written (assert via `asAdmin`). Seed `occurred_at = now()` so rows land in the current (provisioned) partition.
- Gate: `npx tsc --noEmit`, `npm run build` (`/admin/audit` route present), `npm test` green.

## Out of Scope

- Filters (date range, by patient, by actor, by action), pagination beyond the recent cap, CSV export of the audit → follow-ups.
- The curation surface and org enable/disable / superadmin (separately deferred).
- Any change to how logs are written (this is read-only over the existing append-only logs).

## File Structure

- `src/lib/phi/access.ts` — add `listAuditTrail` + `AccessEntry`/`DisclosureEntry`/`AuditTrail`
- `src/app/(app)/admin/audit/page.tsx` — create; `src/app/(app)/admin/page.tsx` — add the Audit Log link
- `tests/db/audit-viewer.test.ts` — create
