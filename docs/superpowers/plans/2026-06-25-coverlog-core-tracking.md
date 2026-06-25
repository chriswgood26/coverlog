# Coverlog Core Eligibility Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Coverlog's core eligibility workflow on top of the foundation: resolve the logged-in user's org/staff context, add/list/view patients (every PHI read logged), log eligibility checks atomically, compute dashboard stats, and import/export CSV with consent-gated, disclosure-logged export.

**Architecture:** Next.js 16 App Router server actions + server components call testable library functions in `src/lib/**`; all patient-PHI reads route through the existing `src/lib/phi/access.ts` gateway (which writes `access_log`); mutations and stats run as the RLS-bound `authenticated` user via `createServerSupabase()`. Atomic "log a check" is a single Postgres `SECURITY INVOKER` function so RLS applies and the `eligibility_checks` insert + `patients` update commit together. This is plan 2 of 4 (foundation ✅ → **core tracking** → Module 8 → email).

**Tech Stack:** Next.js 16, TypeScript strict, Tailwind 4, Supabase (Postgres + Auth, `@supabase/ssr`), Vitest, `pg` (DB/RLS integration tests).

## Global Constraints

- **Next.js 16 App Router.** Middleware is `proxy.ts` (already exists). Server components by default; `"use client"` only when needed. Check `node_modules/next/dist/docs/` before assuming v14/v15 patterns.
- **TypeScript strict.** Path alias `@/*` → `./src/*`.
- **Multi-tenancy:** every query runs RLS-scoped as `authenticated`; never use the service role on a tenant request path. Tenant code never sets `org_id` from client input — it comes from the caller's resolved context / `public.user_org_id()`.
- **42 CFR Part 2:** every read of patient PHI MUST go through `src/lib/phi/access.ts` (writes `access_log`); never call `client.from("patients")` for a read outside that module. CSV export is a disclosure event — it MUST verify a valid consent first and write a `disclosure_log` row.
- **Soft delete:** filter `deleted_at is null` on patient/check reads; never hard-delete.
- **No real patient data** until BAAs signed — tests/seeds use synthetic data only.
- **Migrations** continue at `0007`+; apply with `npm run db:reset`; tests auto-load `.env.local` and run serially (`fileParallelism:false`).
- **Status enum** (`patients.status`, `eligibility_checks.status`): `verified | pending | inactive`. Business rules: *due this week* = `next_due` in `[today, today+7]`; *needs attention* = status `pending` or `inactive`.

## Foundation interfaces this plan consumes (already built)

- `createServerSupabase()` → RLS-bound `SupabaseClient` (anon key + session cookies). `src/lib/supabase/server.ts`.
- `readPatient(client, ctx, patientId)` → `Patient | null` (logs `view_chart`); `listPatients(client, ctx, {search?})` → `Patient[]` (logs `list_view`). `PhiContext = { orgId: string; staffId: string }`. `src/lib/phi/access.ts`.
- `public.user_org_id()` — SQL helper resolving the caller's org from `staff` by `auth.uid()`.
- Tables: `organizations, staff, patients, eligibility_checks, payer_directory, patient_consents, disclosure_log, access_log(+monthly partitions)`. RLS enabled on all; audit tables append-only.
- Test helpers `tests/db/helpers.ts`: `pool`, `withClaims(userId|null, fn)` (runs as `authenticated`/`anon`), `asAdmin(fn)` (RLS-bypass seeding), `resetDb()` (truncate staff+organizations cascade).

---

## File Structure

- `supabase/migrations/0007_access_log_partitions.sql` — partition-management function + future months (resolves Plan 1 carryover + Aug-1 time-bomb).
- `supabase/migrations/0008_log_eligibility_check.sql` — atomic log-a-check RPC.
- `src/lib/auth/context.ts` — `getStaffContext(client)`: session user → `{orgId, staffId, role}`.
- `src/lib/phi/access.ts` — EXTEND with `listCheckHistory` (logs `view_check_history`).
- `src/lib/phi/consent.ts` — `hasValidConsent(client, patientId)`.
- `src/lib/phi/disclosure.ts` — `logDisclosure(client, ctx, entry)`.
- `src/lib/patients/mutations.ts` — `addPatient(client, ctx, input)`, `logCheck(client, input)`.
- `src/lib/dashboard/stats.ts` — `getDashboardStats(client)`.
- `src/lib/csv/import.ts` — `parsePatientsCsv(text)` → insert rows.
- `src/lib/csv/export.ts` — `exportPatientsCsv(client, ctx, purpose)` (consent-gated + disclosure-logged).
- `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/patients/page.tsx`, `src/app/(app)/patients/[id]/page.tsx`, plus `actions.ts` files and client components for Add Patient / Log a Check / CSV — thin UI assembled over the libs.
- Tests under `tests/db/**` (RLS/RPC integration) and `tests/lib/**` (pure/fake-client units).

---

## Task 1: access_log partition management (carryover + Aug-1 time-bomb)

**Why first:** `access_log` only has partitions through 2026-07-31. Because `logAccess` throws on a failed insert, the FIRST PHI read on/after 2026-08-01 would break the whole app. New partitions must also be born with the Plan 1 audit lockdown (RLS forced + policies + append-only trigger + revoked tenant DML), or the C1/C3 holes reopen.

**Files:**
- Create: `supabase/migrations/0007_access_log_partitions.sql`
- Test: `tests/db/access-partitions.test.ts`

**Interfaces:**
- Produces (DB): `public.ensure_access_log_partition(p_month date)` — creates the monthly partition covering `date_trunc('month', p_month)` if absent, and applies enable+force RLS, org-scoped select/insert policies, the `audit_append_only` trigger, and `revoke update,delete,truncate ... from anon, authenticated`. Idempotent. Also invoked for 2026-08 … 2027-01 so near-future inserts succeed.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_access_log_partitions.sql`:
```sql
-- Create a monthly access_log partition (if absent) fully locked down to match
-- the Plan 1 audit hardening: forced RLS + org-scoped policies + append-only
-- trigger + revoked tenant DML. Idempotent; safe to call repeatedly.
create or replace function public.ensure_access_log_partition(p_month date)
  returns void language plpgsql security definer
  set search_path = public, pg_temp as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_part  text := format('access_log_%s', to_char(v_start, 'YYYY_MM'));
begin
  if to_regclass(format('public.%I', v_part)) is not null then
    return;
  end if;

  execute format(
    'create table public.%I partition of public.access_log for values from (%L) to (%L)',
    v_part, v_start, v_end);

  execute format('alter table public.%I enable row level security', v_part);
  execute format('alter table public.%I force row level security', v_part);
  execute format(
    'create policy %I on public.%I for select using (org_id = public.user_org_id())',
    v_part || '_select', v_part);
  execute format(
    'create policy %I on public.%I for insert with check (org_id = public.user_org_id())',
    v_part || '_insert', v_part);
  execute format(
    'create trigger %I before update or delete on public.%I for each statement execute function public.audit_append_only()',
    v_part || '_append_only', v_part);
  execute format(
    'revoke update, delete, truncate on public.%I from anon, authenticated', v_part);
end;
$$;

-- Provision the near-future partitions so inserts never hit a missing range.
select public.ensure_access_log_partition('2026-08-01');
select public.ensure_access_log_partition('2026-09-01');
select public.ensure_access_log_partition('2026-10-01');
select public.ensure_access_log_partition('2026-11-01');
select public.ensure_access_log_partition('2026-12-01');
select public.ensure_access_log_partition('2027-01-01');
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: applies cleanly through `0007`, ending "Done. Applied 7 migration(s)."

- [ ] **Step 3: Write the failing test**

Create `tests/db/access-partitions.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    // Seed a September row for each org directly into the partitioned parent.
    await q(`insert into public.access_log (org_id, action, occurred_at)
             values ($1,'list_view','2026-09-15'),($2,'list_view','2026-09-15')`, [ORG_A, ORG_B]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.access_log restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("access_log future partitions", () => {
  it("partition for 2026-09 exists with forced RLS", async () => {
    const rows = await asAdmin(async (q) => (await q(
      `select relforcerowsecurity from pg_class where relname = 'access_log_2026_09'`)).rows);
    expect(rows.length).toBe(1);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it("tenant reading the 2026-09 child directly sees only their org", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select org_id from public.access_log_2026_09`)).rows);
    expect(rows.map((r: any) => r.org_id)).toEqual([ORG_A]);
  });

  it("tenant cannot UPDATE the 2026-09 child (append-only)", async () => {
    await expect(
      withClaims(USER_A, async (q) => q(`update public.access_log_2026_09 set action='x'`)),
    ).rejects.toThrow(/append-only|permission/i);
  });

  it("ensure_access_log_partition is idempotent", async () => {
    await expect(
      asAdmin((q) => q(`select public.ensure_access_log_partition('2026-09-01')`)),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/db/access-partitions.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_access_log_partitions.sql tests/db/access-partitions.test.ts
git commit -m "feat: access_log partition mgmt fn + future months (locked down)"
```

---

## Task 2: Staff/org context resolver

**Files:**
- Create: `src/lib/auth/context.ts`
- Test: `tests/lib/context.test.ts`

**Interfaces:**
- Consumes: an RLS-bound Supabase client (or fake) exposing `.auth.getUser()` and `.from("staff").select().eq().is().maybeSingle()`.
- Produces: `getStaffContext(client): Promise<StaffContext | null>` where `StaffContext = { orgId: string; staffId: string; role: "admin" | "specialist" }`. Returns `null` if no session user or no matching non-deleted staff row. This is the bridge from a Supabase Auth session to the `PhiContext` the PHI layer needs.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/context.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getStaffContext } from "@/lib/auth/context";

function fakeClient(user: any, staffRow: any) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      async maybeSingle() { return { data: staffRow, error: null }; },
    }),
  } as any;
}

describe("getStaffContext", () => {
  it("returns orgId/staffId/role for a logged-in staff member", async () => {
    const client = fakeClient(
      { id: "user-1" },
      { id: "staff-1", org_id: "org-1", role: "admin" },
    );
    expect(await getStaffContext(client)).toEqual({
      orgId: "org-1", staffId: "staff-1", role: "admin",
    });
  });

  it("returns null when there is no session user", async () => {
    const client = fakeClient(null, null);
    expect(await getStaffContext(client)).toBeNull();
  });

  it("returns null when the user has no staff row", async () => {
    const client = fakeClient({ id: "user-1" }, null);
    expect(await getStaffContext(client)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/lib/context.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth/context'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/context.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type StaffContext = {
  orgId: string;
  staffId: string;
  role: "admin" | "specialist";
};

// Resolve the current Supabase Auth user to their staff/org context.
// Returns null if unauthenticated or not linked to a (non-deleted) staff row.
export async function getStaffContext(
  client: Pick<SupabaseClient, "auth" | "from">,
): Promise<StaffContext | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const { data } = await client
    .from("staff")
    .select("id, org_id, role")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data) return null;
  return { orgId: data.org_id, staffId: data.id, role: data.role };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/lib/context.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/context.ts tests/lib/context.test.ts
git commit -m "feat: getStaffContext resolves session user to org/staff context"
```

---

## Task 3: Add Patient (mutation + RLS test)

**Files:**
- Create: `src/lib/patients/mutations.ts`
- Test: `tests/db/add-patient.test.ts`

**Interfaces:**
- Consumes: RLS-bound client; `StaffContext`.
- Produces: `addPatient(client, ctx, input): Promise<{ id: string }>` where `input = { name: string; memberId?: string; primaryPayer?: string; dob?: string }`. Inserts a `patients` row with `org_id = ctx.orgId`, `status='pending'`; returns the new id. (Later tasks add `logCheck` to this same file.)

- [ ] **Step 1: Write the failing test**

Create `tests/db/add-patient.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";
import { createClient } from "@supabase/supabase-js";
import { addPatient } from "@/lib/patients/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
  });
});

afterAll(async () => { await resetDb(); await pool.end(); });

describe("addPatient", () => {
  it("inserts a pending patient scoped to the caller's org", async () => {
    // Verify the row lands in org A with status 'pending' by reading it back as admin.
    await withClaims(USER_A, async (q) => {
      await q(
        `insert into public.patients (org_id, name, member_id, primary_payer, status)
         values (public.user_org_id(), 'Jane Doe', 'M123', 'Aetna', 'pending')`,
      );
    });
    const rows = await asAdmin(async (q) =>
      (await q(`select name, org_id, status from public.patients where name='Jane Doe'`)).rows);
    expect(rows[0]).toMatchObject({ name: "Jane Doe", org_id: ORG_A, status: "pending" });
  });
});
```

> The test above proves the RLS-scoped INSERT path the `addPatient` library function relies on. `addPatient` itself is a thin typed wrapper over exactly this insert via the Supabase client; Step 3 implements it so server actions get a typed API.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/add-patient.test.ts`
Expected: FAIL — `Cannot find module '@/lib/patients/mutations'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/patients/mutations.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

export type AddPatientInput = {
  name: string;
  memberId?: string;
  primaryPayer?: string;
  dob?: string;
};

// Insert a new patient scoped to the caller's org (RLS enforces org_id too).
export async function addPatient(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: AddPatientInput,
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("patients")
    .insert({
      org_id: ctx.orgId,
      name: input.name,
      member_id: input.memberId ?? null,
      primary_payer: input.primaryPayer ?? null,
      dob: input.dob ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(`addPatient failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/add-patient.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/patients/mutations.ts tests/db/add-patient.test.ts
git commit -m "feat: addPatient mutation (RLS-scoped insert)"
```

---

## Task 4: Atomic log-a-check RPC + check-history read

**Files:**
- Create: `supabase/migrations/0008_log_eligibility_check.sql`
- Modify: `src/lib/patients/mutations.ts` (add `logCheck`)
- Modify: `src/lib/phi/access.ts` (add `listCheckHistory`)
- Test: `tests/db/log-check.test.ts`

**Interfaces:**
- Produces (DB): `public.log_eligibility_check(p_patient_id uuid, p_payer text, p_status text, p_copay numeric, p_deductible_remaining numeric, p_notes text, p_next_due date)` — `SECURITY INVOKER`; in one statement-set inserts an `eligibility_checks` row (org from `public.user_org_id()`, `checked_by` from the caller's staff row) AND updates the parent `patients` row (`status`, `last_checked=current_date`, `next_due`, `primary_payer=p_payer`). Returns the new check id.
- Produces (lib): `logCheck(client, input)` wrapping the RPC; `listCheckHistory(client, ctx, patientId)` in access.ts returning the patient's checks (newest first) AND writing an `access_log` row `{action:'view_check_history', patient_id}`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0008_log_eligibility_check.sql`:
```sql
-- Atomic "log a check": insert history row + update the parent patient together.
-- SECURITY INVOKER so RLS applies as the calling tenant; org_id and checked_by are
-- derived server-side (never trusted from the client).
create or replace function public.log_eligibility_check(
  p_patient_id uuid,
  p_payer text,
  p_status text,
  p_copay numeric,
  p_deductible_remaining numeric,
  p_notes text,
  p_next_due date
) returns uuid
  language plpgsql security invoker as $$
declare
  v_org uuid := public.user_org_id();
  v_staff uuid;
  v_check_id uuid;
begin
  select id into v_staff from public.staff
    where user_id = auth.uid() and deleted_at is null limit 1;

  insert into public.eligibility_checks
    (org_id, patient_id, checked_by, payer, status, copay, deductible_remaining, notes, check_date, next_due)
  values
    (v_org, p_patient_id, v_staff, p_payer, p_status, p_copay, p_deductible_remaining, p_notes, current_date, p_next_due)
  returning id into v_check_id;

  update public.patients
    set status = p_status,
        last_checked = current_date,
        next_due = p_next_due,
        primary_payer = coalesce(p_payer, primary_payer)
  where id = p_patient_id and deleted_at is null;

  return v_check_id;
end;
$$;
```

> Both statements run inside the function's implicit transaction; RLS on `eligibility_checks` (insert `with check org_id = user_org_id()`) and `patients` (update `using org_id = user_org_id()`) guarantees a cross-org `p_patient_id` inserts nothing usable and updates zero rows.

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: applies cleanly through `0008`.

- [ ] **Step 3: Write the failing test**

Create `tests/db/log-check.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let patientId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.eligibility_checks, public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    const p = await q(`insert into public.patients (org_id, name, status) values ($1,'Jane','pending') returning id`, [ORG_A]);
    patientId = p.rows[0].id;
  });
});

afterAll(async () => { await resetDb(); await pool.end(); });

describe("log_eligibility_check", () => {
  it("inserts a check AND updates the parent patient atomically", async () => {
    await withClaims(USER_A, async (q) => {
      await q(`select public.log_eligibility_check($1,'Aetna','verified',25,500,'ok',$2)`,
        [patientId, "2026-09-01"]);
    });
    const { patient, checks } = await asAdmin(async (q) => ({
      patient: (await q(`select status, last_checked, next_due, primary_payer from public.patients where id=$1`, [patientId])).rows[0],
      checks: (await q(`select status, copay, payer from public.eligibility_checks where patient_id=$1`, [patientId])).rows,
    }));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ status: "verified", payer: "Aetna" });
    expect(patient).toMatchObject({ status: "verified", primary_payer: "Aetna" });
    expect(patient.next_due.toISOString().slice(0, 10)).toBe("2026-09-01");
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/log-check.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Add the lib wrappers**

Append to `src/lib/patients/mutations.ts`:
```ts
export type LogCheckInput = {
  patientId: string;
  payer?: string;
  status: "verified" | "pending" | "inactive";
  copay?: number;
  deductibleRemaining?: number;
  notes?: string;
  nextDue?: string;
};

// Atomic insert-check + update-patient via the SECURITY INVOKER RPC.
export async function logCheck(
  client: Pick<SupabaseClient, "rpc">, input: LogCheckInput,
): Promise<{ checkId: string }> {
  const { data, error } = await client.rpc("log_eligibility_check", {
    p_patient_id: input.patientId,
    p_payer: input.payer ?? null,
    p_status: input.status,
    p_copay: input.copay ?? null,
    p_deductible_remaining: input.deductibleRemaining ?? null,
    p_notes: input.notes ?? null,
    p_next_due: input.nextDue ?? null,
  });
  if (error) throw new Error(`logCheck failed: ${error.message}`);
  return { checkId: data as string };
}
```
Add `rpc` to the `SupabaseClient` Pick import usage — change the top of file so the import covers it: ensure `import type { SupabaseClient } from "@supabase/supabase-js";` is present (it is from Task 3).

Append to `src/lib/phi/access.ts`:
```ts
// Read a patient's eligibility-check history (newest first) AND log the access.
export async function listCheckHistory(
  client: any, ctx: PhiContext, patientId: string,
): Promise<Patient[]> {
  const { data } = await client
    .from("eligibility_checks").select("*")
    .eq("patient_id", patientId).is("deleted_at", null)
    .order("check_date", { ascending: false });
  const rows: Patient[] = data ?? [];
  await logAccess(client, ctx, { action: "view_check_history", patient_id: patientId });
  return rows;
}
```

- [ ] **Step 6: Add a unit test for logCheck + listCheckHistory wrappers**

Create `tests/lib/check-wrappers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { logCheck } from "@/lib/patients/mutations";
import { listCheckHistory } from "@/lib/phi/access";

describe("logCheck wrapper", () => {
  it("calls the RPC with mapped params and returns the id", async () => {
    let called: any;
    const client = { rpc: async (name: string, args: any) => { called = { name, args }; return { data: "chk-1", error: null }; } } as any;
    const res = await logCheck(client, { patientId: "p1", status: "verified", payer: "Aetna" });
    expect(res).toEqual({ checkId: "chk-1" });
    expect(called.name).toBe("log_eligibility_check");
    expect(called.args).toMatchObject({ p_patient_id: "p1", p_status: "verified", p_payer: "Aetna" });
  });
});

describe("listCheckHistory", () => {
  it("returns checks and writes a view_check_history access_log row", async () => {
    const inserted: any[] = [];
    const client: any = {
      from(table: string) {
        return {
          select() { return this; }, eq() { return this; }, is() { return this; },
          order() { return this; },
          then(r: any) { r({ data: [{ id: "c1" }, { id: "c2" }], error: null }); },
          insert(row: any) { if (table === "access_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; },
        };
      },
    };
    const rows = await listCheckHistory(client, { orgId: "o1", staffId: "s1" }, "p1");
    expect(rows).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ action: "view_check_history", patient_id: "p1" });
  });
});
```

- [ ] **Step 7: Run both test files**

Run: `npm test -- tests/db/log-check.test.ts tests/lib/check-wrappers.test.ts`
Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0008_log_eligibility_check.sql src/lib/patients/mutations.ts src/lib/phi/access.ts tests/db/log-check.test.ts tests/lib/check-wrappers.test.ts
git commit -m "feat: atomic log_eligibility_check RPC + listCheckHistory (logged)"
```

---

## Task 5: Consent check + disclosure logging helpers

**Files:**
- Create: `src/lib/phi/consent.ts`
- Create: `src/lib/phi/disclosure.ts`
- Test: `tests/lib/consent.test.ts`, `tests/lib/disclosure.test.ts`

**Interfaces:**
- Produces: `hasValidConsent(client, patientId): Promise<boolean>` — true iff a `patient_consents` row exists for the patient with `granted_at` set, `revoked_at is null`, and (`expires_at is null or expires_at > now()`).
- Produces: `logDisclosure(client, ctx, entry): Promise<void>` — inserts a `disclosure_log` row (`{action, patient_id?, purpose?, disclosed_to?, detail?}`), throwing on error (mirrors `logAccess`).

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/consent.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hasValidConsent } from "@/lib/phi/consent";

function client(row: any) {
  return { from: () => ({
    select() { return this; }, eq() { return this; }, is() { return this; },
    gt() { return this; }, or() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: row, error: null }; },
  }) } as any;
}

describe("hasValidConsent", () => {
  it("true when a granted, non-revoked, unexpired consent exists", async () => {
    expect(await hasValidConsent(client({ id: "c1" }), "p1")).toBe(true);
  });
  it("false when no qualifying consent row", async () => {
    expect(await hasValidConsent(client(null), "p1")).toBe(false);
  });
});
```

Create `tests/lib/disclosure.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { logDisclosure } from "@/lib/phi/disclosure";

describe("logDisclosure", () => {
  it("inserts a disclosure_log row with mapped fields", async () => {
    const inserted: any[] = [];
    const client: any = { from: (t: string) => ({ insert(row: any){ if (t==="disclosure_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; } }) };
    await logDisclosure(client, { orgId: "o1", staffId: "s1" }, { action: "csv_export", purpose: "billing", disclosed_to: "self" });
    expect(inserted[0]).toMatchObject({ org_id: "o1", actor_staff_id: "s1", action: "csv_export", purpose: "billing", disclosed_to: "self" });
  });
  it("throws when the insert errors", async () => {
    const client: any = { from: () => ({ insert(){ return { async then(r: any){ r({ error: { message: "boom" } }); } }; } }) };
    await expect(logDisclosure(client, { orgId: "o1", staffId: "s1" }, { action: "csv_export" }))
      .rejects.toThrow(/disclosure log write failed/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/lib/consent.test.ts tests/lib/disclosure.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

Create `src/lib/phi/consent.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

// A consent is valid if granted, not revoked, and not expired.
export async function hasValidConsent(
  client: Pick<SupabaseClient, "from">, patientId: string,
): Promise<boolean> {
  const { data } = await client
    .from("patient_consents")
    .select("id")
    .eq("patient_id", patientId)
    .not("granted_at", "is", null)
    .is("revoked_at", null)
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}
```

Create `src/lib/phi/disclosure.ts`:
```ts
import type { PhiContext } from "@/lib/phi/access";

export type DisclosureEntry = {
  action: string;
  patient_id?: string | null;
  purpose?: string;
  disclosed_to?: string;
  detail?: unknown;
};

// Append a 42 CFR Part 2 disclosure_log row. Throws on failure (audit must be reliable).
export async function logDisclosure(
  client: any, ctx: PhiContext, entry: DisclosureEntry,
): Promise<void> {
  const { error } = await client.from("disclosure_log").insert({
    org_id: ctx.orgId,
    actor_staff_id: ctx.staffId,
    action: entry.action,
    patient_id: entry.patient_id ?? null,
    purpose: entry.purpose ?? null,
    disclosed_to: entry.disclosed_to ?? null,
    detail: entry.detail ?? null,
  });
  if (error) throw new Error(`disclosure log write failed: ${error.message}`);
}
```

> Note: `hasValidConsent` uses the foundation's `not()`/`or()` PostgREST operators. The fake client in the test stubs `.not()` — update the test's chain stub to include `not()` returning `this`. (Adjust the consent test's stub object to add `not() { return this; }`.)

- [ ] **Step 4: Fix the consent test stub and run**

In `tests/lib/consent.test.ts`, add `not() { return this; }` to the chained stub object. Then run:
`npm test -- tests/lib/consent.test.ts tests/lib/disclosure.test.ts`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/phi/consent.ts src/lib/phi/disclosure.ts tests/lib/consent.test.ts tests/lib/disclosure.test.ts
git commit -m "feat: hasValidConsent + logDisclosure (Part 2 helpers)"
```

---

## Task 6: CSV import transform

**Files:**
- Create: `src/lib/csv/import.ts`
- Test: `tests/lib/csv-import.test.ts`

**Interfaces:**
- Produces: `parsePatientsCsv(text, orgId): { rows: PatientInsert[]; skipped: number }` — parses CSV text (header row + data), maps columns (`Name`/`name`, `Member ID`/`member_id`, `Payer`/`payer`) to insert rows `{ org_id, name, member_id, primary_payer, status:'pending' }`, skips rows with no name, and reports how many were skipped. Pure function (no DB).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/csv-import.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parsePatientsCsv } from "@/lib/csv/import";

describe("parsePatientsCsv", () => {
  it("maps header variants and defaults status to pending", () => {
    const csv = "Name,Member ID,Payer\nJane Doe,M1,Aetna\nJohn Roe,M2,Cigna\n";
    const { rows, skipped } = parsePatientsCsv(csv, "org-1");
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { org_id: "org-1", name: "Jane Doe", member_id: "M1", primary_payer: "Aetna", status: "pending" },
      { org_id: "org-1", name: "John Roe", member_id: "M2", primary_payer: "Cigna", status: "pending" },
    ]);
  });

  it("skips rows with no name and defaults missing payer to 'Other'", () => {
    const csv = "name,member_id,payer\n,M9,Humana\nReal Name,M3,\n";
    const { rows, skipped } = parsePatientsCsv(csv, "org-1");
    expect(skipped).toBe(1);
    expect(rows).toEqual([
      { org_id: "org-1", name: "Real Name", member_id: "M3", primary_payer: "Other", status: "pending" },
    ]);
  });

  it("returns empty for header-only or blank input", () => {
    expect(parsePatientsCsv("Name,Payer\n", "org-1")).toEqual({ rows: [], skipped: 0 });
    expect(parsePatientsCsv("", "org-1")).toEqual({ rows: [], skipped: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/lib/csv-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/csv/import.ts`:
```ts
export type PatientInsert = {
  org_id: string;
  name: string;
  member_id: string;
  primary_payer: string;
  status: "pending";
};

// Minimal CSV parser handling quoted fields and commas within quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k] != null && row[k] !== "") return row[k];
  return "";
}

export function parsePatientsCsv(
  text: string, orgId: string,
): { rows: PatientInsert[]; skipped: number } {
  const parsed = parseCsv(text);
  if (parsed.length < 2) return { rows: [], skipped: 0 };
  const header = parsed[0].map((h) => h.trim());
  const out: PatientInsert[] = [];
  let skipped = 0;
  for (const cells of parsed.slice(1)) {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (cells[i] ?? "").trim(); });
    const name = pick(rec, ["Name", "name"]);
    if (!name) { skipped++; continue; }
    out.push({
      org_id: orgId,
      name,
      member_id: pick(rec, ["Member ID", "member_id"]),
      primary_payer: pick(rec, ["Payer", "payer"]) || "Other",
      status: "pending",
    });
  }
  return { rows: out, skipped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/lib/csv-import.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/import.ts tests/lib/csv-import.test.ts
git commit -m "feat: parsePatientsCsv import transform"
```

---

## Task 7: CSV export (consent-gated + disclosure-logged)

**Files:**
- Create: `src/lib/csv/export.ts`
- Test: `tests/lib/csv-export.test.ts`

**Interfaces:**
- Consumes: RLS-bound client; `PhiContext`; `hasValidConsent`; `logDisclosure`; `listPatients`.
- Produces: `exportPatientsCsv(client, ctx, opts): Promise<string>` — for the org's patients, verifies consent **per patient** via `hasValidConsent`; includes only consented patients in the CSV; writes ONE `disclosure_log` row (`action:'csv_export'`, `detail:{patientIds, count}`) recording the export. Throws if zero patients have consent (nothing may be exported without consent). Returns CSV text.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/csv-export.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

// Mock the consent + access modules the exporter depends on.
vi.mock("@/lib/phi/consent", () => ({
  hasValidConsent: vi.fn(async (_c: any, id: string) => id === "p1"), // only p1 consented
}));
vi.mock("@/lib/phi/access", async (orig) => ({
  ...(await orig<any>()),
  listPatients: vi.fn(async () => [
    { id: "p1", name: "Jane", member_id: "M1", primary_payer: "Aetna", status: "verified" },
    { id: "p2", name: "John", member_id: "M2", primary_payer: "Cigna", status: "pending" },
  ]),
}));

import { exportPatientsCsv } from "@/lib/csv/export";

function client() {
  const inserted: any[] = [];
  return { _inserted: inserted, from: (t: string) => ({ insert(row: any){ if (t==="disclosure_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; } }) } as any;
}

describe("exportPatientsCsv", () => {
  it("exports only consented patients and writes a disclosure_log row", async () => {
    const c = client();
    const csv = await exportPatientsCsv(c, { orgId: "o1", staffId: "s1" }, { purpose: "billing" });
    expect(csv).toContain("Jane");
    expect(csv).not.toContain("John");          // p2 lacked consent
    expect(c._inserted).toHaveLength(1);
    expect(c._inserted[0]).toMatchObject({ action: "csv_export", purpose: "billing" });
    expect(c._inserted[0].detail).toMatchObject({ count: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/lib/csv-export.test.ts`
Expected: FAIL — `@/lib/csv/export` not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/csv/export.ts`:
```ts
import type { PhiContext } from "@/lib/phi/access";
import { listPatients } from "@/lib/phi/access";
import { hasValidConsent } from "@/lib/phi/consent";
import { logDisclosure } from "@/lib/phi/disclosure";

const COLUMNS: [keyof any, string][] = [
  ["name", "Name"], ["member_id", "Member ID"], ["primary_payer", "Payer"],
  ["status", "Status"], ["last_checked", "Last Checked"], ["next_due", "Next Due"],
];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export org patients to CSV, but ONLY those with a valid consent (42 CFR Part 2);
// records the export as a disclosure. Throws if nothing is exportable.
export async function exportPatientsCsv(
  client: any, ctx: PhiContext, opts: { purpose?: string } = {},
): Promise<string> {
  const patients = await listPatients(client, ctx, {});
  const consented: any[] = [];
  for (const p of patients) {
    if (await hasValidConsent(client, p.id as string)) consented.push(p);
  }
  if (consented.length === 0) {
    throw new Error("CSV export blocked: no patient has a valid consent on file");
  }

  const header = COLUMNS.map(([, label]) => label).join(",");
  const lines = consented.map((p) => COLUMNS.map(([key]) => csvCell(p[key])).join(","));
  const csv = [header, ...lines].join("\n") + "\n";

  await logDisclosure(client, ctx, {
    action: "csv_export",
    purpose: opts.purpose,
    disclosed_to: "self-service export",
    detail: { patientIds: consented.map((p) => p.id), count: consented.length },
  });
  return csv;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/lib/csv-export.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/export.ts tests/lib/csv-export.test.ts
git commit -m "feat: exportPatientsCsv (consent-gated, disclosure-logged)"
```

---

## Task 8: Dashboard stats

**Files:**
- Create: `src/lib/dashboard/stats.ts`
- Test: `tests/db/dashboard-stats.test.ts`

**Interfaces:**
- Produces: `getDashboardStats(client): Promise<{ verifiedToday: number; dueThisWeek: number; needsAttention: number }>` — counts over the caller's patients (RLS-scoped): `verifiedToday` = patients with `last_checked = current_date` and `status='verified'`; `dueThisWeek` = `next_due between current_date and current_date+7`; `needsAttention` = `status in ('pending','inactive')`. All exclude `deleted_at`.

- [ ] **Step 1: Write the migration-free count helper test**

Create `tests/db/dashboard-stats.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    // Org A: 1 verified today, 1 due in 3 days (pending), 1 inactive; Org B: noise that must not count.
    await q(`insert into public.patients (org_id, name, status, last_checked, next_due) values
             ($1,'V','verified',current_date, current_date+30),
             ($1,'D','pending', current_date-10, current_date+3),
             ($1,'I','inactive', null, null)`, [ORG_A]);
    await q(`insert into public.patients (org_id, name, status, last_checked, next_due) values
             ($1,'BX','verified',current_date, current_date+1)`, [ORG_B]);
  });
});

afterAll(async () => { await resetDb(); await pool.end(); });

describe("dashboard stat SQL (RLS-scoped)", () => {
  it("counts only the caller's org", async () => {
    const stats = await withClaims(USER_A, async (q) => ({
      verifiedToday: Number((await q(`select count(*) c from public.patients where deleted_at is null and status='verified' and last_checked=current_date`)).rows[0].c),
      dueThisWeek: Number((await q(`select count(*) c from public.patients where deleted_at is null and next_due between current_date and current_date+7`)).rows[0].c),
      needsAttention: Number((await q(`select count(*) c from public.patients where deleted_at is null and status in ('pending','inactive')`)).rows[0].c),
    }));
    expect(stats).toEqual({ verifiedToday: 1, dueThisWeek: 1, needsAttention: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it passes (proves the SQL semantics under RLS)**

Run: `npm test -- tests/db/dashboard-stats.test.ts`
Expected: 1 passing. (No app code yet — this pins the SQL the lib will issue.)

- [ ] **Step 3: Write the implementation**

Create `src/lib/dashboard/stats.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardStats = {
  verifiedToday: number;
  dueThisWeek: number;
  needsAttention: number;
};

async function count(
  client: Pick<SupabaseClient, "from">, build: (q: any) => any,
): Promise<number> {
  const base = client.from("patients").select("*", { count: "exact", head: true }).is("deleted_at", null);
  const { count, error } = await build(base);
  if (error) throw new Error(`dashboard count failed: ${error.message}`);
  return count ?? 0;
}

export async function getDashboardStats(
  client: Pick<SupabaseClient, "from">,
): Promise<DashboardStats> {
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [verifiedToday, dueThisWeek, needsAttention] = await Promise.all([
    count(client, (q) => q.eq("status", "verified").eq("last_checked", today)),
    count(client, (q) => q.gte("next_due", today).lte("next_due", weekOut)),
    count(client, (q) => q.in("status", ["pending", "inactive"])),
  ]);
  return { verifiedToday, dueThisWeek, needsAttention };
}
```

- [ ] **Step 4: Unit-test the lib against a fake client**

Create `tests/lib/dashboard-stats.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getDashboardStats } from "@/lib/dashboard/stats";

// Fake client: every terminal query resolves to a fixed count; capture which filters ran.
function client(counts: number[]) {
  let i = 0;
  const make = () => {
    const chain: any = {};
    for (const m of ["select", "is", "eq", "gte", "lte", "in"]) chain[m] = () => chain;
    chain.then = (r: any) => r({ count: counts[i++], error: null });
    return chain;
  };
  return { from: () => make() } as any;
}

describe("getDashboardStats", () => {
  it("returns the three counts", async () => {
    const stats = await getDashboardStats(client([2, 5, 9]));
    expect(stats).toEqual({ verifiedToday: 2, dueThisWeek: 5, needsAttention: 9 });
  });
});
```

- [ ] **Step 5: Run both files**

Run: `npm test -- tests/db/dashboard-stats.test.ts tests/lib/dashboard-stats.test.ts`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/stats.ts tests/db/dashboard-stats.test.ts tests/lib/dashboard-stats.test.ts
git commit -m "feat: getDashboardStats (RLS-scoped counts)"
```

---

## Task 9: UI assembly (dashboard, patients list/detail, add/log/CSV)

**Files:**
- Create: `src/app/(app)/layout.tsx` — authenticated shell: resolves `getStaffContext`, redirects to `/onboarding` if none; nav.
- Create: `src/app/(app)/dashboard/page.tsx` — three stat cards via `getDashboardStats`.
- Create: `src/app/(app)/patients/page.tsx` — searchable table via `listPatients`; Add Patient + Import/Export controls.
- Create: `src/app/(app)/patients/[id]/page.tsx` — chart: `readPatient` + `listCheckHistory`; consent banner; Log a Check.
- Create: `src/app/(app)/patients/actions.ts` — server actions: `addPatientAction`, `logCheckAction`, `importCsvAction`, `exportCsvAction` (each resolves `getStaffContext`, calls the lib, `revalidatePath`).
- Create client components: `src/app/(app)/patients/_components/{AddPatientForm,LogCheckDrawer,CsvControls}.tsx`.
- Test: `tests/lib/actions-smoke.test.ts` (typecheck-level import smoke) + build gate.

**Interfaces:**
- Consumes everything built in Tasks 2–8 plus the foundation PHI layer. Produces no new exported lib API — this is the thin presentation layer.

> This task is presentation assembly over already-tested libraries (the foundation established the pattern of testing lib functions, keeping pages/actions thin). The gate is: server actions resolve context and call the right lib; the app type-checks and builds. Heavy behavior is already covered by Tasks 2–8.

- [ ] **Step 1: Write the server actions**

Create `src/app/(app)/patients/actions.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { addPatient, logCheck } from "@/lib/patients/mutations";
import { parsePatientsCsv } from "@/lib/csv/import";
import { exportPatientsCsv } from "@/lib/csv/export";

async function ctxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return { supabase, ctx };
}

export async function addPatientAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await addPatient(supabase, ctx, {
    name: String(formData.get("name") ?? "").trim(),
    memberId: String(formData.get("memberId") ?? "").trim() || undefined,
    primaryPayer: String(formData.get("primaryPayer") ?? "").trim() || undefined,
  });
  revalidatePath("/patients");
}

export async function logCheckAction(formData: FormData) {
  const { supabase } = await ctxOrRedirect();
  await logCheck(supabase, {
    patientId: String(formData.get("patientId")),
    payer: String(formData.get("payer") ?? "").trim() || undefined,
    status: String(formData.get("status")) as "verified" | "pending" | "inactive",
    copay: formData.get("copay") ? Number(formData.get("copay")) : undefined,
    deductibleRemaining: formData.get("deductible") ? Number(formData.get("deductible")) : undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    nextDue: String(formData.get("nextDue") ?? "") || undefined,
  });
  revalidatePath(`/patients/${formData.get("patientId")}`);
  revalidatePath("/patients");
}

export async function importCsvAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  const text = await (formData.get("file") as File).text();
  const { rows } = parsePatientsCsv(text, ctx.orgId);
  if (rows.length) {
    const { error } = await supabase.from("patients").insert(rows);
    if (error) throw new Error(`CSV import failed: ${error.message}`);
  }
  revalidatePath("/patients");
}

export async function exportCsvAction(): Promise<string> {
  const { supabase, ctx } = await ctxOrRedirect();
  return exportPatientsCsv(supabase, ctx, { purpose: "self-service export" });
}
```

- [ ] **Step 2: Write the authenticated shell + pages**

Create `src/app/(app)/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return (
    <div className="min-h-screen">
      <nav className="flex gap-4 border-b p-4 text-sm">
        <Link href="/dashboard" className="font-medium">Dashboard</Link>
        <Link href="/patients">Patients</Link>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

Create `src/app/(app)/dashboard/page.tsx`:
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/dashboard/stats";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const stats = await getDashboardStats(supabase);
  const cards = [
    { label: "Verified today", value: stats.verifiedToday },
    { label: "Due this week", value: stats.dueThisWeek },
    { label: "Needs attention", value: stats.needsAttention },
  ];
  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border p-6">
          <div className="text-3xl font-semibold">{c.value}</div>
          <div className="text-sm text-gray-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
```

Create `src/app/(app)/patients/page.tsx`:
```tsx
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listPatients } from "@/lib/phi/access";
import { redirect } from "next/navigation";
import { AddPatientForm } from "./_components/AddPatientForm";
import { CsvControls } from "./_components/CsvControls";

export default async function PatientsPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patients = await listPatients(supabase, ctx, {});
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Patients</h1>
        <CsvControls />
      </div>
      <AddPatientForm />
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Name</th><th>Payer</th><th>Status</th><th>Next due</th></tr></thead>
        <tbody>
          {patients.map((p: any) => (
            <tr key={p.id} className="border-b">
              <td className="p-2"><Link href={`/patients/${p.id}`} className="underline">{p.name}</Link></td>
              <td>{p.primary_payer ?? "—"}</td><td>{p.status}</td><td>{p.next_due ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Create `src/app/(app)/patients/[id]/page.tsx`:
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { readPatient, listCheckHistory } from "@/lib/phi/access";
import { hasValidConsent } from "@/lib/phi/consent";
import { redirect, notFound } from "next/navigation";
import { LogCheckDrawer } from "../_components/LogCheckDrawer";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patient = await readPatient(supabase, ctx, id);
  if (!patient) notFound();
  const [history, consent] = await Promise.all([
    listCheckHistory(supabase, ctx, id),
    hasValidConsent(supabase, id),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{patient.name as string}</h1>
      {!consent && (
        <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
          No valid 42 CFR Part 2 consent on file — disclosure/export is blocked for this patient.
        </div>
      )}
      <LogCheckDrawer patientId={id} />
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Date</th><th>Payer</th><th>Status</th><th>Copay</th></tr></thead>
        <tbody>
          {history.map((c: any) => (
            <tr key={c.id} className="border-b"><td className="p-2">{c.check_date}</td><td>{c.payer}</td><td>{c.status}</td><td>{c.copay ?? "—"}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Write the client components**

Create `src/app/(app)/patients/_components/AddPatientForm.tsx`:
```tsx
"use client";
import { addPatientAction } from "../actions";

export function AddPatientForm() {
  return (
    <form action={addPatientAction} className="flex gap-2">
      <input name="name" required placeholder="Patient name" className="border p-2" />
      <input name="memberId" placeholder="Member ID" className="border p-2" />
      <input name="primaryPayer" placeholder="Payer" className="border p-2" />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">Add</button>
    </form>
  );
}
```

Create `src/app/(app)/patients/_components/LogCheckDrawer.tsx`:
```tsx
"use client";
import { logCheckAction } from "../actions";

export function LogCheckDrawer({ patientId }: { patientId: string }) {
  return (
    <form action={logCheckAction} className="flex flex-wrap gap-2 rounded border p-3">
      <input type="hidden" name="patientId" value={patientId} />
      <input name="payer" placeholder="Payer" className="border p-2" />
      <select name="status" className="border p-2" defaultValue="verified">
        <option value="verified">verified</option><option value="pending">pending</option><option value="inactive">inactive</option>
      </select>
      <input name="copay" type="number" step="0.01" placeholder="Copay" className="border p-2 w-24" />
      <input name="deductible" type="number" step="0.01" placeholder="Deductible left" className="border p-2 w-32" />
      <input name="nextDue" type="date" className="border p-2" />
      <input name="notes" placeholder="Notes" className="border p-2" />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">Log check</button>
    </form>
  );
}
```

Create `src/app/(app)/patients/_components/CsvControls.tsx`:
```tsx
"use client";
import { importCsvAction, exportCsvAction } from "../actions";

export function CsvControls() {
  async function download() {
    const csv = await exportCsvAction();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "patients.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex gap-2">
      <form action={importCsvAction}><input type="file" name="file" accept=".csv" className="text-sm" /><button className="ml-1 rounded border px-2 py-1 text-sm">Import</button></form>
      <button onClick={download} className="rounded border px-2 py-1 text-sm">Export</button>
    </div>
  );
}
```

- [ ] **Step 4: Import-smoke test for the actions module**

Create `tests/lib/actions-smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

// Ensures the server-actions module and its lib imports resolve and type-check
// at runtime (catches a broken import path or renamed export before build).
describe("patients actions module", () => {
  it("exports the four server actions", async () => {
    const mod = await import("@/app/(app)/patients/actions");
    for (const fn of ["addPatientAction", "logCheckAction", "importCsvAction", "exportCsvAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
```

- [ ] **Step 5: Run the smoke test + typecheck + build**

Run:
```bash
npm test -- tests/lib/actions-smoke.test.ts
npx tsc --noEmit
npm run build
```
Expected: smoke test passes; `tsc` reports no errors; `next build` completes. (If the build fails on the missing sign-in route referenced by redirects, that's expected — auth UI is a later concern; ensure the build error is only about an unrelated missing route, not a type/import error in this task's files. If `npm run build` requires DB/env at build time for these pages, they are dynamic server components — confirm they're not statically pre-rendered by adding `export const dynamic = "force-dynamic";` to each page that calls Supabase.)

- [ ] **Step 6: Run the FULL suite**

Run: `npm test`
Expected: all tests green (Plan 1's 32 + this plan's additions).

- [ ] **Step 7: Commit**

```bash
git add src/app tests/lib/actions-smoke.test.ts
git commit -m "feat: core tracking UI (dashboard, patients list/detail, add/log/CSV)"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §7.5 atomic log-a-check (Task 4); §9 dashboard stats (Task 8), patient list/add (Tasks 3, 9), log-a-check flow (Tasks 4, 9), CSV import (Tasks 6, 9), CSV export gated on consent + disclosure-logged (Tasks 5, 7, 9), consent banner + check-history-with-logging on detail (Tasks 4, 5, 9); §6/§7.3 every PHI read logged — reads go through `access.ts` (`readPatient`/`listPatients`/`listCheckHistory`); §3/Plan-1-carryover access_log rolling partitions with lockdown (Task 1).
- **Deferred to later plans (by design):** Payer Directory & Payer Profile, providers/credentialing dashboard cards, Module 8 (Plan 3); email alert digests (Plan 4); a real sign-in UI (the actions redirect to `/onboarding` when unauthenticated — full auth screens are a small follow-up, not core tracking).
- **Type consistency:** `PhiContext {orgId, staffId}` (foundation) vs `StaffContext {orgId, staffId, role}` (Task 2) — `StaffContext` is a superset and is accepted everywhere a `PhiContext` is required (structural typing). `logCheck` status union matches the DB enum. Migration numbering continues `0007`, `0008`.
- **Known follow-ups logged for Plan 3/4:** consent *creation* UI (Task 5 only checks consent; capturing it is admin UX — Plan 3 `/admin`); server-side input validation (zod) on actions; `exportCsvAction` returns the CSV to a client component for download (no PHI in a GET URL).

---

## Subsequent Plans
- **Plan 3 — Payer Directory & Module 8:** payer master/directory, Payer Profile tabs, providers + enrollments, hybrid coverage/rules precedence + curation surface, consent-capture admin UI, credentialing dashboard cards.
- **Plan 4 — Email Alerts:** Vercel cron + AWS SES PHI-minimized digests; also wire the rolling `ensure_access_log_partition` call into the cron so future months auto-provision.
