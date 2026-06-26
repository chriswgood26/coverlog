# Coverlog Provider Credentialing (Module 8.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the credentialing surface — a Providers page (list/add/edit with license + expiration), per-payer enrollment management as the "Enrolled Providers" tab on the Payer Profile, two dashboard alert cards (licenses expiring / revalidations due, 60-day window), and a patient-chart cross-reference from a patient's linked payer to that payer's covered codes.

**Architecture:** The credentialing tables (`providers`, `payer_enrollments`) already exist with full org-isolation RLS from migration `0003`. This plan is therefore **one small migration + tested libs + thin server components**, matching Plans 1–3: RLS-scoped reads/writes run as `authenticated` via the request-bound `createServerSupabase` client; `org_id` always comes from `ctx.orgId`/`public.user_org_id()`, never client input; pages set `export const dynamic = "force-dynamic"`. This is plan 3b of the Module 8 arc (3a payer intelligence ✅ → **3b credentialing** → 3c consent admin).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind 4, Supabase (Postgres + Auth, `@supabase/ssr`), Vitest, `pg` (DB/RLS integration tests).

## Global Constraints

- **Next.js 16 App Router.** Middleware is `proxy.ts`. Server components by default; `"use client"` only when needed. Pages calling Supabase set `export const dynamic = "force-dynamic"`.
- **TypeScript strict.** Path alias `@/*` → `./src/*`.
- **Multi-tenancy:** every query runs RLS-scoped as `authenticated`; never the service role on a tenant request path. `org_id` never from client input — always `ctx.orgId` / `public.user_org_id()`.
- **42 CFR Part 2 / PHI:** credentialing data (providers, enrollments) is org reference data, NOT patient PHI — it does not go through `src/lib/phi/access.ts`. The patient cross-reference (Task 6) reads the patient via `readPatient` (which logs `view_chart`), but the coverage lookup itself is payer reference data and is NOT logged.
- **Migrations** continue at `0012`; apply with `npm run db:reset`; tests auto-load `.env.local` and run serially (`fileParallelism:false`).
- **Dashboard alert window:** 60 days, anchored to DB `current_date` (no JS timezone coupling).
- **Admin-gated mutations:** provider/enrollment writes require `ctx.role === "admin"`; reads are open to all staff.

## Foundation this plan builds on (already merged)

- **Migration `0003`** created `public.providers(id, org_id, name, npi, license_type, license_number, license_state, license_expiration, created_at, deleted_at)` and `public.payer_enrollments(id, org_id, provider_id→providers(id), payer_id→payer_directory(id), status ∈ {enrolled,pending,terminated,not_enrolled} default 'pending', par_status ∈ {in_network,out_of_network}, effective_date, termination_date, revalidation_due, caqh_id, notes, created_at)` — both with org-isolation RLS (`for all using/with check org_id = public.user_org_id()`).
- **Plan 3a:** `payer_master`, `payer_directory.payer_master_id`, `resolveCoverage`/`resolveClaimRules` in `src/lib/payers/resolve.ts`, the tabbed Payer Profile at `src/app/(app)/payers/[id]/page.tsx`, and `src/app/(app)/payers/[id]/_components/`.
- **Foundation:** `public.user_org_id()`; `getStaffContext`/`StaffContext` (`src/lib/auth/context.ts` — `{ orgId, staffId, role: "admin"|"specialist" }`); `createServerSupabase` (`src/lib/supabase/server.ts`); PHI access layer `src/lib/phi/access.ts` (`readPatient` does `select("*")`); dashboard pattern (`dashboard_stats()` SQL fn → `getDashboardStats` in `src/lib/dashboard/stats.ts` → 3-card grid in `src/app/(app)/dashboard/page.tsx`); test helpers in `tests/db/helpers.ts` (`pool`, `withClaims`, `asAdmin`, `resetDb`); `npm run db:reset`.

> **Why `payer_enrollments.payer_id` references `payer_directory(id)` (per-org), not `payer_master`:** an enrollment is org-specific (this clinic's provider with this clinic's payer record), so it keys on the org's directory row. The Payer Profile is routed by `payer_directory.id` (`/payers/[id]`), so the Enrolled Providers tab queries enrollments by `payer_id = <that directory id>` directly.

---

## File Structure

- `supabase/migrations/0012_credentialing.sql` — `patients.primary_payer_directory_id` FK; `org_enrollment_unique` index; `credentialing_stats()` function.
- `src/lib/providers/mutations.ts` — `createProvider`, `updateProvider`, `softDeleteProvider`, `upsertEnrollment`.
- `src/lib/providers/queries.ts` — `listProviders`, `getProvider`, `listEnrollmentsForPayer`, `listEnrollmentsForProvider`.
- `src/lib/dashboard/stats.ts` — extend with `getCredentialingStats`.
- `src/app/(app)/providers/page.tsx`, `.../providers/actions.ts`, `.../providers/_components/AddProviderForm.tsx`.
- `src/app/(app)/payers/[id]/_components/EnrolledProvidersTab.tsx`; `src/app/(app)/payers/actions.ts` (extend); `src/app/(app)/payers/[id]/page.tsx` (render tab).
- `src/app/(app)/patients/[id]/page.tsx` (extend); `src/app/(app)/patients/actions.ts` (extend).
- `src/app/(app)/layout.tsx` (Providers nav link); `src/app/(app)/dashboard/page.tsx` (5 cards).
- Tests: `tests/db/credentialing-schema.test.ts`, `tests/db/providers.test.ts`, `tests/db/credentialing-stats.test.ts`, `tests/lib/providers-actions-smoke.test.ts`.

---

## Task 1: Migration 0012 — patient↔payer FK, enrollment unique index, credentialing_stats()

**Files:**
- Create: `supabase/migrations/0012_credentialing.sql`
- Test: `tests/db/credentialing-schema.test.ts`

**Interfaces:**
- Produces (DB):
  - `public.patients.primary_payer_directory_id uuid references public.payer_directory(id)` (nullable).
  - Unique index `org_enrollment_unique on public.payer_enrollments (org_id, provider_id, payer_id)` — makes the Task 2 `upsertEnrollment` `ON CONFLICT` well-defined.
  - `public.credentialing_stats() returns table (licenses_expiring bigint, revalidations_due bigint)` — `security invoker`, so RLS on `providers`/`payer_enrollments` scopes both counts to the caller's org. `licenses_expiring` = providers (`deleted_at is null`) with `license_expiration <= current_date + 60` (includes overdue). `revalidations_due` = enrollments with `revalidation_due <= current_date + 60` and `status <> 'terminated'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_credentialing.sql`:
```sql
-- Link a patient to one of the org's canonical payer records (for the chart
-- coverage cross-reference). Nullable; free-text patients.primary_payer stays.
alter table public.patients
  add column primary_payer_directory_id uuid references public.payer_directory(id);

-- One enrollment row per (org, provider, payer) so the upsert in
-- src/lib/providers/mutations.ts is well-defined.
create unique index org_enrollment_unique
  on public.payer_enrollments (org_id, provider_id, payer_id);

-- Credentialing dashboard counts, computed server-side so the 60-day window is
-- anchored to the DB's current_date. SECURITY INVOKER so RLS on providers /
-- payer_enrollments scopes the counts to the caller's org. "Expiring" includes
-- already-overdue items (date <= current_date + 60 catches the past too).
create or replace function public.credentialing_stats()
  returns table (licenses_expiring bigint, revalidations_due bigint)
  language sql security invoker as $$
  select
    (select count(*) from public.providers
       where deleted_at is null
         and license_expiration is not null
         and license_expiration <= current_date + 60)                       as licenses_expiring,
    (select count(*) from public.payer_enrollments
       where revalidation_due is not null
         and revalidation_due <= current_date + 60
         and status <> 'terminated')                                        as revalidations_due;
$$;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: applies cleanly through `0012`.

- [ ] **Step 3: Write the failing test**

Create `tests/db/credentialing-schema.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let payerDirId: string;
let patientId: string;
let providerId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.patients,
             public.payer_directory, public.staff, public.organizations
             restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name)
                        values ($1,'Aetna') returning id`, [ORG_A]);
    payerDirId = pd.rows[0].id;
    const pt = await q(`insert into public.patients (org_id, name) values ($1,'Pat') returning id`, [ORG_A]);
    patientId = pt.rows[0].id;
    const pr = await q(`insert into public.providers (org_id, name, license_expiration)
                        values ($1,'Dr A', current_date + 30) returning id`, [ORG_A]);
    providerId = pr.rows[0].id;
    // Second provider's license is far out (90 days) → NOT counted in the 60-day window.
    await q(`insert into public.providers (org_id, name, license_expiration)
             values ($1,'Dr B', current_date + 90)`, [ORG_A]);
    // Enrollment due for revalidation in 10 days → counted.
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 10)`, [ORG_A, providerId, payerDirId]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers,
                          public.patients, public.payer_directory restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("credentialing schema", () => {
  it("links a patient to a payer_directory row via primary_payer_directory_id", async () => {
    await withClaims(USER_A, async (q) =>
      q(`update public.patients set primary_payer_directory_id=$1 where id=$2`, [payerDirId, patientId]));
    const rows = await asAdmin(async (q) =>
      (await q(`select primary_payer_directory_id from public.patients where id=$1`, [patientId])).rows);
    expect(rows[0].primary_payer_directory_id).toBe(payerDirId);
  });

  it("credentialing_stats counts only items inside the 60-day window, RLS-scoped", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select * from public.credentialing_stats()`)).rows);
    expect(Number(rows[0].licenses_expiring)).toBe(1);   // Dr A (30d) yes, Dr B (90d) no
    expect(Number(rows[0].revalidations_due)).toBe(1);   // the 10-day enrollment
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/db/credentialing-schema.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_credentialing.sql tests/db/credentialing-schema.test.ts
git commit -m "feat: credentialing migration (patient-payer FK, enrollment unique, credentialing_stats)"
```

---

## Task 2: Provider + enrollment mutations

**Files:**
- Create: `src/lib/providers/mutations.ts`
- Test: `tests/db/providers.test.ts`

**Interfaces:**
- Consumes: `StaffContext` from `@/lib/auth/context`; `org_enrollment_unique` index (Task 1).
- Produces (all `client: Pick<SupabaseClient,"from">`, `ctx: StaffContext`):
  - `createProvider(client, ctx, input): Promise<{ id: string }>` — `input = { name; npi?; licenseType?; licenseNumber?; licenseState?; licenseExpiration? }` (dates as `YYYY-MM-DD` strings).
  - `updateProvider(client, ctx, id, input): Promise<void>` — same input shape (all optional); updates the org's provider.
  - `softDeleteProvider(client, ctx, id): Promise<void>` — sets `deleted_at = now()`.
  - `upsertEnrollment(client, ctx, input): Promise<void>` — `input = { providerId; payerDirectoryId; status; parStatus?; effectiveDate?; terminationDate?; revalidationDue?; caqhId?; notes? }`; upserts on `(org_id, provider_id, payer_id)`.
  - Types `ProviderInput` and `EnrollmentInput`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/providers.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { createProvider, updateProvider, softDeleteProvider, upsertEnrollment } from "@/lib/providers/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const CTX_A = { orgId: ORG_A, staffId: "s", role: "admin" as const };
let payerDirA: string;
let clientA: ReturnType<typeof createClient>;
let clientB: ReturnType<typeof createClient>;

async function signedInClient(email: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  return c;
}

beforeAll(async () => {
  const a = await admin.auth.admin.createUser({ email: "prov-a@example.com", password: "Test-Passw0rd!", email_confirm: true });
  const b = await admin.auth.admin.createUser({ email: "prov-b@example.com", password: "Test-Passw0rd!", email_confirm: true });
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin'),($3,$4,'Bo','b@b.com','admin')`,
            [ORG_A, a.data!.user!.id, ORG_B, b.data!.user!.id]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name) values ($1,'Aetna') returning id`, [ORG_A]);
    payerDirA = pd.rows[0].id;
  });
  clientA = await signedInClient("prov-a@example.com");
  clientB = await signedInClient("prov-b@example.com");
});

afterAll(async () => {
  for (const email of ["prov-a@example.com", "prov-b@example.com"]) {
    const u = (await admin.auth.admin.listUsers()).data.users.find((x) => x.email === email);
    if (u) await admin.auth.admin.deleteUser(u.id);
  }
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers,
                          public.payer_directory restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("provider mutations", () => {
  it("createProvider writes an org-scoped row", async () => {
    const { id } = await createProvider(clientA, CTX_A, {
      name: "Dr A", npi: "1234567893", licenseType: "LCSW", licenseExpiration: "2027-01-01" });
    const rows = await asAdmin(async (q) =>
      (await q(`select org_id, name, license_type from public.providers where id=$1`, [id])).rows);
    expect(rows[0]).toMatchObject({ org_id: ORG_A, name: "Dr A", license_type: "LCSW" });
  });

  it("updateProvider edits the org's provider; softDeleteProvider hides it", async () => {
    const { id } = await createProvider(clientA, CTX_A, { name: "Dr Edit" });
    await updateProvider(clientA, CTX_A, id, { licenseState: "CA" });
    await softDeleteProvider(clientA, CTX_A, id);
    const rows = await asAdmin(async (q) =>
      (await q(`select license_state, deleted_at from public.providers where id=$1`, [id])).rows);
    expect(rows[0].license_state).toBe("CA");
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("upsertEnrollment is idempotent on (org, provider, payer)", async () => {
    const { id: providerId } = await createProvider(clientA, CTX_A, { name: "Dr Enr" });
    await upsertEnrollment(clientA, CTX_A, { providerId, payerDirectoryId: payerDirA, status: "pending" });
    await upsertEnrollment(clientA, CTX_A, { providerId, payerDirectoryId: payerDirA, status: "enrolled", caqhId: "CAQH9" });
    const rows = await asAdmin(async (q) =>
      (await q(`select status, caqh_id from public.payer_enrollments where provider_id=$1 and payer_id=$2`,
               [providerId, payerDirA])).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "enrolled", caqh_id: "CAQH9" });
  });

  it("another org cannot see org A's providers (RLS)", async () => {
    const { id } = await createProvider(clientA, CTX_A, { name: "Dr Secret" });
    const { data } = await clientB.from("providers").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/providers.test.ts`
Expected: FAIL — `Cannot find module '@/lib/providers/mutations'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/providers/mutations.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

export type ProviderInput = {
  name?: string; npi?: string; licenseType?: string;
  licenseNumber?: string; licenseState?: string; licenseExpiration?: string;
};
export type EnrollmentInput = {
  providerId: string; payerDirectoryId: string;
  status: "enrolled" | "pending" | "terminated" | "not_enrolled";
  parStatus?: "in_network" | "out_of_network";
  effectiveDate?: string; terminationDate?: string; revalidationDue?: string;
  caqhId?: string; notes?: string;
};

// Map a partial ProviderInput to DB columns, omitting undefined keys so update
// only touches provided fields.
function providerColumns(input: ProviderInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.npi !== undefined) out.npi = input.npi;
  if (input.licenseType !== undefined) out.license_type = input.licenseType;
  if (input.licenseNumber !== undefined) out.license_number = input.licenseNumber;
  if (input.licenseState !== undefined) out.license_state = input.licenseState;
  if (input.licenseExpiration !== undefined) out.license_expiration = input.licenseExpiration;
  return out;
}

export async function createProvider(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: ProviderInput,
): Promise<{ id: string }> {
  const { data, error } = await client.from("providers")
    .insert({ org_id: ctx.orgId, ...providerColumns(input) })
    .select("id").single();
  if (error) throw new Error(`createProvider failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

export async function updateProvider(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, id: string, input: ProviderInput,
): Promise<void> {
  const { error } = await client.from("providers")
    .update(providerColumns(input))
    .eq("id", id).eq("org_id", ctx.orgId);
  if (error) throw new Error(`updateProvider failed: ${error.message}`);
}

export async function softDeleteProvider(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, id: string,
): Promise<void> {
  const { error } = await client.from("providers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id).eq("org_id", ctx.orgId);
  if (error) throw new Error(`softDeleteProvider failed: ${error.message}`);
}

export async function upsertEnrollment(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: EnrollmentInput,
): Promise<void> {
  const { error } = await client.from("payer_enrollments").upsert({
    org_id: ctx.orgId, provider_id: input.providerId, payer_id: input.payerDirectoryId,
    status: input.status, par_status: input.parStatus ?? null,
    effective_date: input.effectiveDate ?? null, termination_date: input.terminationDate ?? null,
    revalidation_due: input.revalidationDue ?? null, caqh_id: input.caqhId ?? null,
    notes: input.notes ?? null,
  }, { onConflict: "org_id,provider_id,payer_id" });
  if (error) throw new Error(`upsertEnrollment failed: ${error.message}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/providers.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/mutations.ts tests/db/providers.test.ts
git commit -m "feat: provider + enrollment mutations (org-scoped CRUD + idempotent upsert)"
```

---

## Task 3: Provider + enrollment queries

**Files:**
- Create: `src/lib/providers/queries.ts`
- Test: append to `tests/db/providers.test.ts` (reuses the same fixtures/clients)

**Interfaces:**
- Consumes: Task 2 mutations (to seed rows); RLS-bound client.
- Produces:
  - `listProviders(client): Promise<Provider[]>` — `deleted_at is null`, ordered by `name`.
  - `getProvider(client, id): Promise<Provider | null>`.
  - `listEnrollmentsForPayer(client, payerDirectoryId): Promise<EnrollmentRow[]>` — enrollments for that payer with `provider_name` joined.
  - `listEnrollmentsForProvider(client, providerId): Promise<EnrollmentRow[]>`.
  - Types `Provider` and `EnrollmentRow` (the latter includes `provider_name: string`).

- [ ] **Step 1: Write the failing test (append a new `describe` block)**

Append to `tests/db/providers.test.ts`:
```ts
import { listProviders, listEnrollmentsForPayer } from "@/lib/providers/queries";

describe("provider queries", () => {
  it("listProviders excludes soft-deleted and lists the org's providers", async () => {
    const rows = await listProviders(clientA);
    expect(rows.every((r) => r.deleted_at == null)).toBe(true);
    expect(rows.some((r) => r.name === "Dr A")).toBe(true);
    expect(rows.some((r) => r.name === "Dr Edit")).toBe(false); // soft-deleted in Task 2 test
  });

  it("listEnrollmentsForPayer joins the provider name", async () => {
    const rows = await listEnrollmentsForPayer(clientA, payerDirA);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("provider_name");
    expect(typeof rows[0].provider_name).toBe("string");
  });
});
```
> Add the `import` line at the top of the file with the other imports.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/providers.test.ts`
Expected: FAIL — `Cannot find module '@/lib/providers/queries'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/providers/queries.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type Provider = {
  id: string; name: string; npi: string | null; license_type: string | null;
  license_number: string | null; license_state: string | null;
  license_expiration: string | null; deleted_at: string | null;
};
export type EnrollmentRow = {
  id: string; provider_id: string; payer_id: string; provider_name: string;
  status: string; par_status: string | null; effective_date: string | null;
  termination_date: string | null; revalidation_due: string | null;
  caqh_id: string | null; notes: string | null;
};

export async function listProviders(
  client: Pick<SupabaseClient, "from">,
): Promise<Provider[]> {
  const { data, error } = await client.from("providers")
    .select("id, name, npi, license_type, license_number, license_state, license_expiration, deleted_at")
    .is("deleted_at", null).order("name");
  if (error) throw new Error(`listProviders failed: ${error.message}`);
  return (data ?? []) as Provider[];
}

export async function getProvider(
  client: Pick<SupabaseClient, "from">, id: string,
): Promise<Provider | null> {
  const { data, error } = await client.from("providers")
    .select("id, name, npi, license_type, license_number, license_state, license_expiration, deleted_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`getProvider failed: ${error.message}`);
  return (data ?? null) as Provider | null;
}

// providers!inner(name) embeds the joined provider; we flatten to provider_name.
function flattenEnrollments(data: any[]): EnrollmentRow[] {
  return (data ?? []).map((r: any) => ({
    id: r.id, provider_id: r.provider_id, payer_id: r.payer_id,
    provider_name: r.providers?.name ?? "", status: r.status, par_status: r.par_status,
    effective_date: r.effective_date, termination_date: r.termination_date,
    revalidation_due: r.revalidation_due, caqh_id: r.caqh_id, notes: r.notes,
  }));
}

export async function listEnrollmentsForPayer(
  client: Pick<SupabaseClient, "from">, payerDirectoryId: string,
): Promise<EnrollmentRow[]> {
  const { data, error } = await client.from("payer_enrollments")
    .select("id, provider_id, payer_id, status, par_status, effective_date, termination_date, revalidation_due, caqh_id, notes, providers!inner(name)")
    .eq("payer_id", payerDirectoryId);
  if (error) throw new Error(`listEnrollmentsForPayer failed: ${error.message}`);
  return flattenEnrollments(data ?? []);
}

export async function listEnrollmentsForProvider(
  client: Pick<SupabaseClient, "from">, providerId: string,
): Promise<EnrollmentRow[]> {
  const { data, error } = await client.from("payer_enrollments")
    .select("id, provider_id, payer_id, status, par_status, effective_date, termination_date, revalidation_due, caqh_id, notes, providers!inner(name)")
    .eq("provider_id", providerId);
  if (error) throw new Error(`listEnrollmentsForProvider failed: ${error.message}`);
  return flattenEnrollments(data ?? []);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/providers.test.ts`
Expected: 6 passing (4 from Task 2 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/queries.ts tests/db/providers.test.ts
git commit -m "feat: provider + enrollment queries (list/get + enrollments-by-payer/provider)"
```

---

## Task 4: Credentialing stats lib + dashboard cards

**Files:**
- Modify: `src/lib/dashboard/stats.ts`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Test: `tests/db/credentialing-stats.test.ts`

**Interfaces:**
- Consumes: `credentialing_stats()` RPC (Task 1).
- Produces: `CredentialingStats = { licensesExpiring: number; revalidationsDue: number }` and `getCredentialingStats(client: Pick<SupabaseClient,"rpc">): Promise<CredentialingStats>`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/credentialing-stats.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { getCredentialingStats } from "@/lib/dashboard/stats";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({
    email: "cred-stats@example.com", password: "Test-Passw0rd!", email_confirm: true });
  const userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, userId]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name) values ($1,'Aetna') returning id`, [ORG_A]);
    const pr = await q(`insert into public.providers (org_id, name, license_expiration)
                        values ($1,'Dr Soon', current_date + 20) returning id`, [ORG_A]);
    await q(`insert into public.providers (org_id, name, license_expiration)
             values ($1,'Dr Later', current_date + 120)`, [ORG_A]);   // outside window
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 5)`, [ORG_A, pr.rows[0].id, pd.rows[0].id]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "cred-stats@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  const u = (await admin.auth.admin.listUsers()).data.users.find((x) => x.email === "cred-stats@example.com");
  if (u) await admin.auth.admin.deleteUser(u.id);
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers,
                          public.payer_directory restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("getCredentialingStats", () => {
  it("returns 60-day-window counts scoped to the caller's org", async () => {
    const stats = await getCredentialingStats(userClient);
    expect(stats.licensesExpiring).toBe(1);   // Dr Soon (20d), not Dr Later (120d)
    expect(stats.revalidationsDue).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/credentialing-stats.test.ts`
Expected: FAIL — `getCredentialingStats` is not exported.

- [ ] **Step 3: Add the lib function**

Append to `src/lib/dashboard/stats.ts`:
```ts
export type CredentialingStats = {
  licensesExpiring: number;
  revalidationsDue: number;
};

export async function getCredentialingStats(
  client: Pick<SupabaseClient, "rpc">,
): Promise<CredentialingStats> {
  const { data, error } = await client.rpc("credentialing_stats");
  if (error) throw new Error(`credentialing stats failed: ${error.message}`);
  const row = (data ?? [])[0] ?? {};
  return {
    licensesExpiring: Number(row.licenses_expiring ?? 0),
    revalidationsDue: Number(row.revalidations_due ?? 0),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/credentialing-stats.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Render the two new dashboard cards**

Replace `src/app/(app)/dashboard/page.tsx` with:
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { getDashboardStats, getCredentialingStats } from "@/lib/dashboard/stats";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const [stats, cred] = await Promise.all([
    getDashboardStats(supabase),
    getCredentialingStats(supabase),
  ]);
  const cards = [
    { label: "Verified today", value: stats.verifiedToday },
    { label: "Due this week", value: stats.dueThisWeek },
    { label: "Needs attention", value: stats.needsAttention },
    { label: "Licenses expiring soon", value: cred.licensesExpiring },
    { label: "Enrollments due for revalidation", value: cred.revalidationsDue },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
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

- [ ] **Step 6: Verify build + the stats test**

Run:
```bash
npm test -- tests/db/credentialing-stats.test.ts
npx tsc --noEmit
```
Expected: 1 passing; `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboard/stats.ts "src/app/(app)/dashboard/page.tsx" tests/db/credentialing-stats.test.ts
git commit -m "feat: credentialing dashboard cards (licenses expiring / revalidations due)"
```

---

## Task 5: Providers page + actions + nav

**Files:**
- Create: `src/app/(app)/providers/page.tsx`
- Create: `src/app/(app)/providers/actions.ts`
- Create: `src/app/(app)/providers/_components/AddProviderForm.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `tests/lib/providers-actions-smoke.test.ts`

**Interfaces:**
- Consumes: Task 2 mutations, Task 3 `listProviders`, foundation (`createServerSupabase`, `getStaffContext`).
- Produces: tenant-facing Providers page; server actions `createProviderAction`, `deleteProviderAction`. No new exported lib API.

- [ ] **Step 1: Write the server actions**

Create `src/app/(app)/providers/actions.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { createProvider, softDeleteProvider } from "@/lib/providers/mutations";

async function adminCtxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") throw new Error("Admin role required");
  return { supabase, ctx };
}

export async function createProviderAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await createProvider(supabase, ctx, {
    name: String(formData.get("name") ?? "").trim(),
    npi: String(formData.get("npi") ?? "").trim() || undefined,
    licenseType: String(formData.get("licenseType") ?? "").trim() || undefined,
    licenseNumber: String(formData.get("licenseNumber") ?? "").trim() || undefined,
    licenseState: String(formData.get("licenseState") ?? "").trim() || undefined,
    licenseExpiration: String(formData.get("licenseExpiration") ?? "").trim() || undefined,
  });
  revalidatePath("/providers");
}

export async function deleteProviderAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await softDeleteProvider(supabase, ctx, String(formData.get("id")));
  revalidatePath("/providers");
}
```

- [ ] **Step 2: Write the add-provider form component**

Create `src/app/(app)/providers/_components/AddProviderForm.tsx`:
```tsx
import { createProviderAction } from "../actions";

export function AddProviderForm() {
  return (
    <form action={createProviderAction} className="flex flex-wrap gap-2">
      <input name="name" required placeholder="Provider name" className="border p-1" />
      <input name="npi" placeholder="NPI" className="border p-1 w-32" />
      <input name="licenseType" placeholder="License (LCSW…)" className="border p-1 w-32" />
      <input name="licenseNumber" placeholder="License #" className="border p-1 w-28" />
      <input name="licenseState" placeholder="State" className="border p-1 w-16" />
      <input name="licenseExpiration" type="date" className="border p-1" />
      <button className="rounded bg-black px-2 py-1 text-white text-sm">Add provider</button>
    </form>
  );
}
```

- [ ] **Step 3: Write the providers page**

Create `src/app/(app)/providers/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listProviders } from "@/lib/providers/queries";
import { AddProviderForm } from "./_components/AddProviderForm";
import { deleteProviderAction } from "./actions";

export default async function ProvidersPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const providers = await listProviders(supabase);
  const isAdmin = ctx.role === "admin";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Providers</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Name</th><th>NPI</th><th>License</th><th>State</th><th>Expires</th><th></th></tr></thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="p-2">{p.name}</td><td>{p.npi ?? "—"}</td>
              <td>{p.license_type ?? "—"}{p.license_number ? ` ${p.license_number}` : ""}</td>
              <td>{p.license_state ?? "—"}</td><td>{p.license_expiration ?? "—"}</td>
              <td>{isAdmin && (
                <form action={deleteProviderAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="text-red-700 underline">Remove</button>
                </form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && <AddProviderForm />}
    </div>
  );
}
```

- [ ] **Step 4: Add the Providers nav link**

In `src/app/(app)/layout.tsx`, add inside `<nav>` after the Payers link:
```tsx
        <Link href="/providers">Providers</Link>
```

- [ ] **Step 5: Smoke test the actions module**

Create `tests/lib/providers-actions-smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("providers actions module", () => {
  it("exports the provider server actions", async () => {
    const mod = await import("@/app/(app)/providers/actions");
    for (const fn of ["createProviderAction", "deleteProviderAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
```

- [ ] **Step 6: Run smoke + typecheck**

Run:
```bash
npm test -- tests/lib/providers-actions-smoke.test.ts
npx tsc --noEmit
```
Expected: smoke passes; `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/providers" "src/app/(app)/layout.tsx" tests/lib/providers-actions-smoke.test.ts
git commit -m "feat: providers page + add/remove actions + nav link"
```

---

## Task 6: Enrolled Providers tab + patient chart cross-reference

**Files:**
- Create: `src/app/(app)/payers/[id]/_components/EnrolledProvidersTab.tsx`
- Modify: `src/app/(app)/payers/actions.ts` (add `saveEnrollmentAction`)
- Modify: `src/app/(app)/payers/[id]/page.tsx` (render the tab)
- Modify: `src/app/(app)/patients/actions.ts` (add `linkPatientPayerAction`)
- Modify: `src/app/(app)/patients/[id]/page.tsx` (coverage cross-reference + link form)
- Test: extend `tests/lib/providers-actions-smoke.test.ts`

**Interfaces:**
- Consumes: Task 2 `upsertEnrollment`, Task 3 `listEnrollmentsForPayer`/`listProviders`, Plan 3a `resolveCoverage`, foundation (`readPatient`).
- Produces: the 4th Payer Profile tab + patient cross-reference. Server actions `saveEnrollmentAction` (payers), `linkPatientPayerAction` (patients).

- [ ] **Step 1: Add the enrollment server action**

Append to `src/app/(app)/payers/actions.ts` (keep the existing imports/actions; add this import and function):
```ts
import { upsertEnrollment } from "@/lib/providers/mutations";

export async function saveEnrollmentAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  if (ctx.role !== "admin") throw new Error("Admin role required");
  await upsertEnrollment(supabase, ctx, {
    providerId: String(formData.get("providerId")),
    payerDirectoryId: String(formData.get("payerDirectoryId")),
    status: String(formData.get("status") ?? "pending") as
      "enrolled" | "pending" | "terminated" | "not_enrolled",
    parStatus: (String(formData.get("parStatus") ?? "").trim() || undefined) as
      "in_network" | "out_of_network" | undefined,
    effectiveDate: String(formData.get("effectiveDate") ?? "").trim() || undefined,
    revalidationDue: String(formData.get("revalidationDue") ?? "").trim() || undefined,
    caqhId: String(formData.get("caqhId") ?? "").trim() || undefined,
  });
  revalidatePath(`/payers/${formData.get("payerDirectoryId")}`);
}
```
> `ctxOrRedirect` already exists in this file (from Plan 3a); reuse it.

- [ ] **Step 2: Write the Enrolled Providers tab component**

Create `src/app/(app)/payers/[id]/_components/EnrolledProvidersTab.tsx`:
```tsx
import type { EnrollmentRow, Provider } from "@/lib/providers/queries";
import { saveEnrollmentAction } from "../../actions";

export function EnrolledProvidersTab({ rows, providers, payerDirectoryId, isAdmin }:
  { rows: EnrollmentRow[]; providers: Provider[]; payerDirectoryId: string; isAdmin: boolean }) {
  return (
    <section>
      <h2 className="font-medium">Enrolled Providers</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Provider</th><th>Status</th><th>PAR</th><th>Effective</th><th>Revalidation</th><th>CAQH</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.provider_name}</td><td>{r.status}</td>
              <td>{r.par_status ?? "—"}</td><td>{r.effective_date ?? "—"}</td>
              <td>{r.revalidation_due ?? "—"}</td><td>{r.caqh_id ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && providers.length > 0 && (
        <form action={saveEnrollmentAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <select name="providerId" required className="border p-1">
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="status" className="border p-1">
            <option value="pending">pending</option><option value="enrolled">enrolled</option>
            <option value="terminated">terminated</option><option value="not_enrolled">not enrolled</option>
          </select>
          <select name="parStatus" className="border p-1">
            <option value="">PAR —</option><option value="in_network">in network</option>
            <option value="out_of_network">out of network</option>
          </select>
          <input name="effectiveDate" type="date" className="border p-1" />
          <input name="revalidationDue" type="date" className="border p-1" />
          <input name="caqhId" placeholder="CAQH ID" className="border p-1 w-28" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Save enrollment</button>
        </form>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Render the tab on the Payer Profile**

In `src/app/(app)/payers/[id]/page.tsx`, add imports and fetch enrollments + providers, then render the tab. Add these imports near the top:
```tsx
import { listEnrollmentsForPayer, listProviders } from "@/lib/providers/queries";
import { EnrolledProvidersTab } from "./_components/EnrolledProvidersTab";
```
After the existing `const [coverage, rules] = ...` block, add:
```tsx
  const [enrollments, providers] = await Promise.all([
    listEnrollmentsForPayer(supabase, id),
    listProviders(supabase),
  ]);
```
Then, in the returned JSX, insert the tab after the Portal Access `<section>` and before `<CoveredCodesTab .../>`:
```tsx
      <EnrolledProvidersTab rows={enrollments} providers={providers} payerDirectoryId={id} isAdmin={ctx.role === "admin"} />
```

- [ ] **Step 4: Add the patient↔payer link action**

`src/app/(app)/patients/actions.ts` already imports `revalidatePath`, `redirect`, `createServerSupabase`, `getStaffContext`, and defines a `ctxOrRedirect()` helper (from Plan 2). Add NO new imports — just append this function (reusing `ctxOrRedirect`):
```ts
export async function linkPatientPayerAction(formData: FormData) {
  const { supabase } = await ctxOrRedirect();
  const patientId = String(formData.get("patientId"));
  const payerDirectoryId = String(formData.get("payerDirectoryId")) || null;
  const { error } = await supabase.from("patients")
    .update({ primary_payer_directory_id: payerDirectoryId })
    .eq("id", patientId);
  if (error) throw new Error(`linkPatientPayer failed: ${error.message}`);
  revalidatePath(`/patients/${patientId}`);
}
```
> The RLS policy on `patients` already scopes the `.update` to the caller's org, so no explicit `.eq("org_id", …)` is needed (matches the existing patient mutations).

- [ ] **Step 5: Add the coverage cross-reference to the patient chart**

In `src/app/(app)/patients/[id]/page.tsx`, add imports:
```tsx
import { resolveCoverage } from "@/lib/payers/resolve";
import { linkPatientPayerAction } from "../actions";
```
After `const patient = ... ; if (!patient) notFound();` and the existing `Promise.all`, add coverage resolution and the org's payer list:
```tsx
  const payerDirId = (patient as any).primary_payer_directory_id as string | null;
  const { data: orgPayers } = await supabase
    .from("payer_directory").select("id, payer_name, payer_master_id").order("payer_name");
  const linked = payerDirId ? (orgPayers ?? []).find((p: any) => p.id === payerDirId) : null;
  const coverage = linked?.payer_master_id
    ? await resolveCoverage(supabase, linked.payer_master_id as string)
    : [];
```
Then add a section to the returned JSX (e.g. after the `<LogCheckDrawer .../>` line):
```tsx
      <section className="space-y-2">
        <h2 className="font-medium">Primary payer coverage</h2>
        <form action={linkPatientPayerAction} className="flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="patientId" value={id} />
          <select name="payerDirectoryId" defaultValue={payerDirId ?? ""} className="border p-1">
            <option value="">— not linked —</option>
            {(orgPayers ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.payer_name}</option>)}
          </select>
          <button className="rounded bg-black px-2 py-1 text-white">Link payer</button>
        </form>
        {linked && !linked.payer_master_id && (
          <p className="text-sm text-amber-700">Linked payer isn&apos;t mapped to a canonical payer yet — no baseline coverage to show.</p>
        )}
        {coverage.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left"><th className="p-2">CPT</th><th>Covered</th><th>Prior auth</th><th>Source</th></tr></thead>
            <tbody>
              {coverage.map((r) => (
                <tr key={r.cpt_code} className="border-b">
                  <td className="p-2">{r.cpt_code}</td><td>{r.covered ? "Yes" : "No"}</td>
                  <td>{r.requires_prior_auth ? "Yes" : "No"}</td>
                  <td>{r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
```

- [ ] **Step 6: Extend the smoke test**

Append to `tests/lib/providers-actions-smoke.test.ts`:
```ts
describe("enrollment + patient-link actions", () => {
  it("payers actions export saveEnrollmentAction", async () => {
    const mod = await import("@/app/(app)/payers/actions");
    expect(typeof (mod as any).saveEnrollmentAction).toBe("function");
  });
  it("patients actions export linkPatientPayerAction", async () => {
    const mod = await import("@/app/(app)/patients/actions");
    expect(typeof (mod as any).linkPatientPayerAction).toBe("function");
  });
});
```

- [ ] **Step 7: Run smoke + typecheck + build + full suite**

Run:
```bash
npm test -- tests/lib/providers-actions-smoke.test.ts
npx tsc --noEmit
npm run build
npm test
```
Expected: smoke passes (3 tests); `tsc` clean; `next build` completes with `/providers` and `/payers/[id]` routes; full suite green.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/payers" "src/app/(app)/patients" tests/lib/providers-actions-smoke.test.ts
git commit -m "feat: Enrolled Providers tab + patient primary-payer coverage cross-reference"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §8.1 Provider Credentialing Tracker → Providers page list/add/edit + license/expiration (Task 5), per-payer enrollment status with effective/termination/revalidation dates + CAQH (Tasks 2, 6), dashboard "Licenses expiring soon" + "Enrollments due for revalidation" cards (Tasks 1, 4). §8.4 Payer Profile "Enrolled Providers" tab (Task 6). Patient `primary_payer` → coverage cross-reference (Tasks 1, 6).
- **Deferred (by design):** consent-capture admin + staff/role management → Plan 3c; email/cron alerts for expirations → Plan 4; claim-scrubbing/837P → out of scope (§8.3 note); Office Ally / crowd-sourcing → out.
- **Migration numbering:** continues `0012` (single migration); `db:reset` rebuilds cleanly in order.
- **Type consistency:** `ProviderInput`/`EnrollmentInput` (Task 2) consumed by actions (Tasks 5, 6); `Provider`/`EnrollmentRow` (Task 3) consumed by the providers page and Enrolled Providers tab (Tasks 5, 6); `CredentialingStats`/`getCredentialingStats` (Task 4) consumed by the dashboard; `resolveCoverage`/`ResolvedCoverage` (Plan 3a) consumed by the patient cross-reference (Task 6). `payer_enrollments.payer_id` (directory id) used consistently — enrollments key on `payer_directory.id`, matching the `/payers/[id]` route param.
- **RLS isolation:** all provider/enrollment libs take `Pick<SupabaseClient,"from">` and run on the request-bound RLS client; cross-org isolation asserted in Task 2. `credentialing_stats()` is `security invoker` so its counts are RLS-scoped (asserted in Tasks 1, 4). No service role anywhere in this plan.
- **Admin gating:** provider/enrollment mutations require `ctx.role === "admin"` in the server actions; reads open to all staff.

---

## Subsequent Plans
- **Plan 3c — Consent-capture admin UI:** `/admin` consent management (create/revoke `patient_consents`), staff & role management.
- **Plan 4 — Email Alerts + ops:** Vercel cron + AWS SES PHI-minimized digests (including the license-expiring / revalidation-due alerts this plan surfaces in-app); rolling `ensure_access_log_partition` cron (release gate before 2028-12).
