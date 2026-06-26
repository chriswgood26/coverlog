# Coverlog Email Alert Digests (AWS SES) + Rolling Ops Cron — Design

**Status:** Approved (2026-06-25)
**Plan:** 4 of the roadmap (Plan 1 Foundation ✅ → Plan 2 Core Tracking ✅ → Plan 3/3a/3b/3c ✅ → **Plan 4 alerts + ops**).

## Goal

Ship the two scheduled jobs the system needs to run unattended: (1) a **weekly per-org email digest** (AWS SES) of actionable counts — licenses expiring, enrollment revalidations due, consents expiring, eligibility due-this-week and needs-attention — delivered PHI-minimized to each org's active admins; and (2) a **rolling `access_log` partition cron** that auto-extends the monthly-partition runway so PHI reads never break (the dated release gate before 2028-12).

## Decisions (resolved in brainstorming)

1. **One plan, both subsystems** — the partition cron is small and a hard release gate, so it ships alongside the digest system.
2. **Vercel Cron → CRON_SECRET-guarded Next route handlers** for both jobs (matches the deploy platform; jobs live in-app and are testable). The partition route drives the existing `ensure_access_log_partition` RPC.
3. **Weekly digest to each org's active admins**, PHI-minimized: aggregate counts + a login link only — no patient names, member IDs, DOB, or provider names in the email body.
4. **Signals:** all four groups — licenses expiring (≤60d), enrollment revalidations due (≤60d), consents expiring (≤60d), and eligibility due-this-week + needs-attention.

## Foundation this builds on (already merged)

- **Partition infra:** `public.access_log` is monthly range-partitioned; `public.ensure_access_log_partition(p_month date)` (`SECURITY DEFINER`, idempotent) creates one locked-down partition (forced RLS + org policies + append-only trigger + revoked tenant DML). Runway provisioned through **2028-12** (migration `0007`). The PHI access layer THROWS on a failed `access_log` insert, so a missing partition breaks ALL reads — the rolling cron is the release gate.
- **Per-org stat logic (RLS-scoped, session-bound — cannot be reused by a system job):** `dashboard_stats()` → `(verified_today, due_this_week, needs_attention)` (migration `0009`); `credentialing_stats()` → `(licenses_expiring, revalidations_due)` (migration `0012`). Both `SECURITY INVOKER`, windowed to `current_date`.
- **Consents:** `patient_consents(... expires_at, revoked_at ...)`; "expiring" = `expires_at` within 60 days and not revoked (new count for the digest).
- **Service-role client:** `createServiceSupabase()` (`src/lib/supabase/service.ts`, BYPASSES RLS) — the established off-tenant-path writer/reader for system jobs (curation in 3a). Only imported by curation/cron code, never tenant pages.
- **Staff:** `staff(org_id, name, email, role ∈ {admin,specialist}, deleted_at)` — active admins = `role='admin' and deleted_at is null`.
- **Stack:** Next.js 16 (route handlers, `proxy.ts`), TS strict, Supabase, Vitest, hosted-Supabase test harness (`tests/db/helpers.ts`: `pool`, `asAdmin`, `withClaims`, `resetDb`; `npm run db:reset`; serial). Shared convention: email/SMS integrations **gracefully no-op when API keys are missing**.

## Architecture

Two Vercel Cron jobs hit `CRON_SECRET`-guarded Next route handlers backed by tested libs. The digest job runs with **no user session**, so per-org counts come from a new `SECURITY DEFINER` SQL function taking `p_org_id` (an `INVOKER` function would return nothing without a session). PHI never enters email — bodies are built only from aggregate integer counts + a generic login link. Service role is used ONLY on these off-tenant cron paths.

### Units

**1. Migration `0013_alerts_ops.sql`** — two `SECURITY DEFINER` functions; for each: `revoke execute ... from anon, authenticated` and `grant execute ... to service_role` (so only the service-role cron may call them; tenants cannot read other orgs).
- `org_alert_counts(p_org_id uuid) returns table (licenses_expiring bigint, revalidations_due bigint, consents_expiring bigint, due_this_week bigint, needs_attention bigint)` — all counts filtered to `p_org_id`, windowed to `current_date`:
  - `licenses_expiring` = `providers` where `org_id=p_org_id and deleted_at is null and license_expiration is not null and license_expiration <= current_date + 60`.
  - `revalidations_due` = `payer_enrollments` where `org_id=p_org_id and revalidation_due is not null and revalidation_due <= current_date + 60 and status <> 'terminated'`.
  - `consents_expiring` = `patient_consents` where `org_id=p_org_id and revoked_at is null and expires_at is not null and expires_at <= current_date + 60`.
  - `due_this_week` = `patients` where `org_id=p_org_id and deleted_at is null and next_due between current_date and current_date + 7`.
  - `needs_attention` = `patients` where `org_id=p_org_id and deleted_at is null and status in ('pending','inactive')`.
- `ensure_upcoming_access_log_partitions(p_months int) returns int` — loops `m` from 0..`p_months`, calls `ensure_access_log_partition(date_trunc('month', current_date) + (m || ' months')::interval)`; returns the count ensured. `SECURITY DEFINER`, idempotent.

**2. Digest content lib** (`src/lib/email/digest.ts`, pure — no I/O):
- `AlertCounts = { licensesExpiring: number; revalidationsDue: number; consentsExpiring: number; dueThisWeek: number; needsAttention: number }`.
- `shouldSendDigest(counts: AlertCounts): boolean` — true iff any count > 0 (skip all-zero orgs → no noise).
- `buildOrgDigest(orgName: string, counts: AlertCounts, appUrl: string): { subject: string; html: string; text: string }` — subject like `Coverlog weekly summary — <orgName>`; body lists the five labeled counts and a single login link (`appUrl`). PHI-minimized by construction: the only inputs are an org name, integer counts, and a URL.

**3. SES wrapper + cron auth** (`src/lib/email/ses.ts`):
- `sendEmail({ to: string[]; subject: string; html: string; text: string }): Promise<{ sent: boolean; skipped?: boolean }>` — sends via `@aws-sdk/client-sesv2` `SendEmailCommand` from `SES_FROM_ADDRESS`. If `SES_FROM_ADDRESS` or AWS credentials are absent, returns `{ sent: false, skipped: true }` without throwing (shared graceful-degradation convention). On SES error, throws.
- `cronAuthorized(req: Request): boolean` — true iff `req.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET` and `CRON_SECRET` is set. (Vercel injects this header on cron invocations when `CRON_SECRET` is configured.)

**4. Digest orchestration** (`src/lib/email/runDigest.ts`):
- `runWeeklyDigest(opts?: { send?: SendFn; client?: ServiceClient }): Promise<DigestSummary>` — defaults: `send = sendEmail`, `client = createServiceSupabase()`. Steps: list all orgs (`organizations`); for each, fetch `org_alert_counts` (RPC) and active-admin emails (`staff` where `role='admin' and deleted_at is null`); if `shouldSendDigest` and there is ≥1 recipient, `buildOrgDigest` and `send`. Returns `{ orgsProcessed, digestsSent, skipped }`. The injectable `send` makes it testable without SES.
- `appUrl` from `process.env.NEXT_PUBLIC_APP_URL` (fallback to a constant).

**5. Cron routes + wiring:**
- `src/app/api/cron/weekly-digest/route.ts` — `export async function GET(req)`: `if (!cronAuthorized(req)) return 401`; `const summary = await runWeeklyDigest(); return Response.json(summary)`. `export const dynamic = "force-dynamic"`.
- `src/app/api/cron/ensure-partitions/route.ts` — `GET(req)`: auth guard; `createServiceSupabase().rpc("ensure_upcoming_access_log_partitions", { p_months: 6 })`; return JSON.
- `vercel.json` crons: `{ path: "/api/cron/weekly-digest", schedule: "0 13 * * 1" }` (Mon 13:00 UTC), `{ path: "/api/cron/ensure-partitions", schedule: "0 4 1 * *" }` (1st of month 04:00 UTC).
- Add dependency `@aws-sdk/client-sesv2`. Document env in `.env.local.example`: `CRON_SECRET`, `SES_FROM_ADDRESS`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `NEXT_PUBLIC_APP_URL`.

## Data Flow

- **Weekly digest:** Vercel cron `GET /api/cron/weekly-digest` (Bearer CRON_SECRET) → `cronAuthorized` → `runWeeklyDigest` → service client lists orgs → per-org `org_alert_counts` RPC + admin emails → `shouldSendDigest` gate → `buildOrgDigest` → `sendEmail` (SES) → JSON summary.
- **Partition roll:** Vercel cron `GET /api/cron/ensure-partitions` → auth → service client `rpc("ensure_upcoming_access_log_partitions", {p_months:6})` → Postgres creates any missing of the next 6 months → JSON.

## Error Handling

- Route handlers return `401` on failed `cronAuthorized`; otherwise run the job and return a JSON summary. Uncaught job errors surface as a 500 (Vercel logs/retries).
- `sendEmail` returns `{skipped:true}` when creds/from are missing (no throw); throws on an actual SES API error.
- SQL functions: `SECURITY DEFINER` with `set search_path = public, pg_temp`; execute revoked from anon/authenticated.
- `runWeeklyDigest` continues to the next org if one org's send fails? — **v1: fail-fast** (let the error propagate so Vercel surfaces it); per-org error isolation is a future hardening (noted out of scope).

## Testing

TDD against the hosted-Supabase harness (serial, `.env.local`, `npm run db:reset`).

- `tests/db/alerts-ops.test.ts` — seed two orgs with providers/enrollments/consents/patients inside & outside the windows; assert `org_alert_counts(orgA)` returns the exact five counts and EXCLUDES org B's rows (the `SECURITY DEFINER` + `p_org_id` filter is the isolation); assert `ensure_upcoming_access_log_partitions(6)` makes the next 6 monthly partitions exist (query `pg_class`), is idempotent on re-run, and that a freshly created partition has forced RLS.
- `tests/lib/digest-content.test.ts` — `shouldSendDigest` true/false on mixed/all-zero counts; `buildOrgDigest` includes each labeled count and the login link, the subject carries the org name, and the body contains no input other than counts/orgName/url (PHI-minimized).
- `tests/lib/cron-auth.test.ts` — `cronAuthorized` accepts the correct Bearer token, rejects missing/wrong token and unset `CRON_SECRET`.
- `tests/lib/run-digest.test.ts` — `runWeeklyDigest({ send: fakeSender, client })` against a seeded DB: builds one digest per org with counts, recipients = active admins only (deactivated/specialist excluded), all-zero orgs skipped, orgs with no admins skipped; `fakeSender` records calls (no SES). 
- `tests/lib/ses-skip.test.ts` — `sendEmail` returns `{skipped:true}` when `SES_FROM_ADDRESS` is unset.
- Final gate: `npx tsc --noEmit`, `npm run build`, `npm test`.

## Out of Scope (by design)

- User-composed / freeform email (a fresh PHI/Part 2 review is required before adding it).
- Password-reset / magic-link auth.
- A sent-digest idempotency/audit table (weekly cron is best-effort; a double-run double-sends — acceptable for v1).
- Per-org error isolation in the digest run (v1 fail-fast).
- SMS (Twilio) alerts.
- Vercel Hobby-plan cron limits (assumes Vercel Pro).

## File Structure

- `supabase/migrations/0013_alerts_ops.sql`
- `src/lib/email/digest.ts`, `src/lib/email/ses.ts`, `src/lib/email/runDigest.ts`
- `src/app/api/cron/weekly-digest/route.ts`, `src/app/api/cron/ensure-partitions/route.ts`
- `vercel.json`, `.env.local.example` (extend), `package.json` (+`@aws-sdk/client-sesv2`)
- Tests: `tests/db/alerts-ops.test.ts`, `tests/lib/digest-content.test.ts`, `tests/lib/cron-auth.test.ts`, `tests/lib/run-digest.test.ts`, `tests/lib/ses-skip.test.ts`
