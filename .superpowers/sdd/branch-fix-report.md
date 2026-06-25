# Branch Security Fix Report — `feat/coverlog-foundation`

**Date:** 2026-06-25
**Branch:** `feat/coverlog-foundation`
**Fixes addressing:** C1, C2, C3 (Critical), I1 (Important)

---

## Executive Summary

All four confirmed security findings (C1, C2, C3, I1) have been fixed. The full test suite
was **32/32 passing** after the fixes. One pre-existing test (`unauthenticated request sees
nothing`) required updating to reflect the *stronger* security behavior (permission-denied
vs. the previous empty-rows-via-RLS behavior).

---

## Finding Fixes

### C1 — Partition children have no RLS

**Root cause:** `enable row level security` was only on the parent `access_log` table.
Direct queries against `public.access_log_2026_06` or `public.access_log_2026_07` bypassed
RLS entirely, exposing all orgs' rows.

**Fix — `supabase/migrations/0006_audit_lockdown.sql`:**
```sql
alter table public.access_log_2026_06 enable row level security;
alter table public.access_log_2026_06 force row level security;
alter table public.access_log_2026_07 enable row level security;
alter table public.access_log_2026_07 force row level security;

create policy access_2026_06_select on public.access_log_2026_06
  for select using (org_id = public.user_org_id());
create policy access_2026_06_insert on public.access_log_2026_06
  for insert with check (org_id = public.user_org_id());
-- (same for _07 child)
```

**Verified by test:** `C1 — partition child RLS isolation` — user A queries
`access_log_2026_06` directly and sees only org A rows; user B sees only org B rows.

---

### C2 — Tenants can TRUNCATE/UPDATE/DELETE the audit tables

**Root cause:** `alter default privileges ... grant all on tables to ... authenticated`
in `db-reset.mjs` granted TRUNCATE, UPDATE, DELETE to the `authenticated` role on all
tables. TRUNCATE bypasses both RLS policies and BEFORE triggers — a tenant could wipe the
entire cross-org audit trail.

**Fix (two-part):**

1. **`scripts/db-reset.mjs`** — Changed default table privileges to exclude `anon` and
   `authenticated`:
   ```sql
   alter default privileges in schema public grant all on tables to postgres, service_role;
   -- anon and authenticated now get NO default table grants
   ```

2. **`supabase/migrations/0006_audit_lockdown.sql`** — Explicit REVOKE:
   ```sql
   revoke update, delete, truncate
     on public.access_log, public.access_log_2026_06, public.access_log_2026_07,
        public.disclosure_log
     from anon, authenticated;
   ```
   Then explicit re-grants for `authenticated` on the tables it legitimately needs,
   with audit tables getting only `select, insert`.

**Verified by test:** `C2 — TRUNCATE on audit tables denied for authenticated` — three tests
confirm `truncate access_log`, `truncate disclosure_log`, and `truncate access_log_2026_06`
all throw `permission denied`.

---

### C3 — Append-only trigger bypassed via partition child

**Root cause:** The `audit_append_only()` trigger was on the parent `access_log` only.
`UPDATE`/`DELETE` issued directly against `public.access_log_2026_06` routed around the
trigger entirely.

**Fix — `supabase/migrations/0006_audit_lockdown.sql`:**
```sql
create trigger access_2026_06_append_only
  before update or delete on public.access_log_2026_06
  for each statement execute function public.audit_append_only();
create trigger access_2026_07_append_only
  before update or delete on public.access_log_2026_07
  for each statement execute function public.audit_append_only();
```

Note: In practice, the C2 REVOKE means `authenticated` no longer has `UPDATE`/`DELETE`
privileges on the partition children at all, so the trigger is a defense-in-depth layer.
Both protections are in place.

**Verified by test:** `C3 — append-only enforcement on partition children` — UPDATE and
DELETE on `access_log_2026_06` and `access_log_2026_07` both reject with either
`append-only` (trigger) or `permission denied` (revoked privilege). The data integrity
verification test confirms the original row is unchanged after attempted mutations.

---

### I1 — Onboarding has no idempotency guard

**Root cause:** `createOrgWithFirstAdmin` in `src/lib/onboarding.ts` unconditionally
created a new org + staff row on every call. A second call with the same `userId` would
create a duplicate org.

**Fix — `src/lib/onboarding.ts`:**
Added an idempotency guard inside the transaction that checks for an existing non-deleted
staff row for the `userId` before creating anything:
```typescript
const existing = await client.query(
  `select id, org_id from public.staff
   where user_id = $1 and deleted_at is null
   limit 1`,
  [input.userId],
);
if (existing.rows.length > 0) {
  await client.query("commit");
  return { orgId: existing.rows[0].org_id, staffId: existing.rows[0].id };
}
```

**Verified by test:** `tests/db/onboarding.test.ts` — new test asserts that a second call
with the same `userId` (but different `orgName`) returns the original `orgId`, only one
staff row exists for that user, and only one org exists.

---

## db:reset Output

```
Resetting public schema…
Applying 0001_core_tenancy.sql … ok
Applying 0002_patients_checks.sql … ok
Applying 0003_module8.sql … ok
Applying 0004_part2_logging.sql … ok
Applying 0005_pgaudit.sql … ok
Applying 0006_audit_lockdown.sql … ok
Done. Applied 6 migration(s).
```

No errors during reset.

---

## Full Test Suite Result

```
Test Files  10 passed (10)
     Tests  32 passed (32)
  Duration  ~5.6s
```

32 tests across 10 test files, all passing.

---

## Grant Adjustments Made

The `db-reset.mjs` change meant `authenticated` lost default table grants, which would have
broken existing RLS tests (e.g., tenancy, patients, module8). To restore correct access:

- **`0006_audit_lockdown.sql`** adds explicit `grant select, insert, update, delete` to
  `authenticated` on all non-audit tenant tables.
- **`0006_audit_lockdown.sql`** grants only `select, insert` to `authenticated` on
  `disclosure_log`, `access_log`, and the two partition children.
- `anon` gets no grants at all on tenant tables.

**Pre-existing test update:** `tests/db/tenancy.test.ts` — the "unauthenticated request
sees nothing" test previously expected an empty array (RLS filtering). After the fix, `anon`
gets `permission denied` (no grant at all), which is a *stronger* guarantee. The test was
updated to accept either outcome (empty rows OR permission-denied error) since both mean
"anon sees zero data."

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/0006_audit_lockdown.sql` | New — fixes C1, C2, C3 with RLS enable/force on children, partition policies, append-only triggers on children, REVOKEs, and explicit re-grants for `authenticated` |
| `scripts/db-reset.mjs` | Removed `anon, authenticated` from default table privilege grant |
| `src/lib/onboarding.ts` | Added idempotency guard (I1) |
| `tests/db/onboarding.test.ts` | Added idempotency regression test |
| `tests/db/audit-lockdown.test.ts` | New — C1/C2/C3 regression tests (9 tests) |
| `tests/db/tenancy.test.ts` | Updated anon test to accept permission-denied (stronger security) |

---

## Concerns

None. All fixes applied cleanly. The `force row level security` on partition children
ensures even the table owner (postgres/service_role) goes through RLS when acting as
`authenticated`, which is correct for this multi-tenant model.

The REVOKE + explicit re-grant pattern is the correct approach for Supabase hosted
environments where `postgres` owns the objects. All REVOKE statements succeeded.
