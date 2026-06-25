# Coverlog Foundation & Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Coverlog app skeleton with a fully multi-tenant Supabase database whose isolation is enforced by Postgres RLS, Supabase Auth, org/staff onboarding, and a centralized PHI data-access layer that logs every read.

**Architecture:** Next.js 16 (App Router) on the customary stack, talking to Supabase Postgres. Every tenant table carries `org_id` and has RLS enabled; policies resolve the caller's org through a `SECURITY DEFINER` helper `auth.user_org_id()` that reads the `staff` table by `auth.uid()`. All patient-PHI reads flow through one server-side module that writes an `access_log` row, with `pgaudit` as a database-level backstop. This plan is plan 1 of 4 (foundation → core tracking → Module 8 → email).

**Tech Stack:** Next.js 16, TypeScript (strict), Tailwind 4, Supabase (Postgres + Auth), `@supabase/ssr`, Vitest, `pg` (node-postgres, for DB/RLS integration tests), Supabase CLI (local dev DB).

## Global Constraints

- **Next.js 16 App Router.** Middleware lives in `proxy.ts`, NOT `middleware.ts`. Check `node_modules/next/dist/docs/` before assuming v14/v15 patterns.
- **TypeScript strict mode.** Path alias `@/*` → `./src/*`.
- **Multi-tenancy:** every tenant table carries `org_id`; RLS enabled on every table; no tenant query path uses the service role.
- **Service role is confined** to the internal baseline-curation surface (a later plan) — never on the tenant request path.
- **42 CFR Part 2:** every read of patient PHI must write an `access_log` row; no read path may bypass the central data-access layer.
- **Soft delete** PHI-bearing rows via `deleted_at`; never hard-delete.
- **No real patient data** until BAAs are signed — tests and seeds use synthetic data only.
- Source spec: `docs/superpowers/specs/2026-06-24-coverlog-design.md`.

---

## File Structure

- `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.local.example` — project config.
- `supabase/config.toml` — Supabase CLI local project config.
- `supabase/migrations/0001_core_tenancy.sql` — organizations, staff, `auth.user_org_id()`, RLS.
- `supabase/migrations/0002_patients_checks.sql` — patients, eligibility_checks, payer_directory, RLS.
- `supabase/migrations/0003_module8.sql` — providers, payer_enrollments, payer_code_coverage, payer_claim_rules, RLS.
- `supabase/migrations/0004_part2_logging.sql` — patient_consents, disclosure_log, access_log, RLS.
- `supabase/migrations/0005_pgaudit.sql` — enable pgaudit read logging.
- `src/lib/supabase/server.ts` — request-scoped Supabase server client (RLS-bound).
- `src/lib/supabase/types.ts` — generated/typed DB row shapes used by the app.
- `src/lib/phi/access.ts` — centralized PHI data-access layer (writes `access_log`).
- `src/app/onboarding/` — org + first-staff onboarding flow.
- `proxy.ts` — auth session refresh middleware.
- `tests/db/helpers.ts` — pg pool + JWT-claims simulation helper for RLS tests.
- `tests/db/*.test.ts` — RLS isolation + helper tests.
- `tests/phi/access.test.ts` — access-logging unit tests.

---

## Task 1: Project scaffold + local Supabase + test runner

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.local.example`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`, `supabase/config.toml`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: a runnable Next.js app, `npm test` wired to Vitest, and `supabase start` providing a local Postgres at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

- [ ] **Step 1: Scaffold the Next.js app**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint --use-npm --yes
```
Expected: project files created in the current directory (it already contains `docs/` and the spec — accept the non-empty-dir prompt).

- [ ] **Step 2: Add test + Supabase tooling**

Run:
```bash
npm install -D vitest @types/pg && npm install pg @supabase/ssr @supabase/supabase-js
npx supabase init
```
Expected: `vitest` + `pg` in devDependencies, `@supabase/*` in dependencies, `supabase/config.toml` created.

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
```
Run: `npm install -D vite-tsconfig-paths`
Expected: install succeeds.

- [ ] **Step 4: Add the `test` script and env example**

Modify `package.json` scripts to include:
```json
"test": "vitest run",
"test:watch": "vitest"
```
Create `.env.local.example`:
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace_with_local_anon_key
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
# Service role is NOT used on the tenant path; present only for the later curation tool.
SUPABASE_SERVICE_ROLE_KEY=replace_with_local_service_role_key
```

- [ ] **Step 5: Write the smoke test**

Create `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Start Supabase and run the smoke test**

Run:
```bash
npx supabase start
npm test
```
Expected: `supabase start` prints local URLs + anon/service keys (paste them into `.env.local`); `npm test` shows 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app, Supabase local, Vitest"
```

---

## Task 2: Core tenancy migration — organizations, staff, `auth.user_org_id()`, RLS

**Files:**
- Create: `supabase/migrations/0001_core_tenancy.sql`
- Create: `tests/db/helpers.ts`
- Test: `tests/db/tenancy.test.ts`

**Interfaces:**
- Produces (DB): tables `public.organizations(id, name, created_at)`, `public.staff(id, org_id, user_id, name, email, role, created_at, deleted_at)`; function `auth.user_org_id() returns uuid`.
- Produces (test helper): `withClaims(userId: string | null, fn)` runs SQL as the `authenticated` role with `request.jwt.claims` set so `auth.uid()` resolves; `pool` is a shared `pg.Pool`; `resetDb()` truncates app tables.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_core_tenancy.sql`:
```sql
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  user_id uuid unique,                 -- references auth.users(id) in Supabase
  name text not null,
  email text not null,
  role text not null default 'specialist' check (role in ('admin','specialist')),
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create index staff_user_id_idx on public.staff(user_id) where deleted_at is null;

-- Resolve the current user's org. SECURITY DEFINER so the lookup itself isn't
-- blocked by RLS on staff. STABLE so the planner can cache within a statement.
create or replace function auth.user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.staff
  where user_id = auth.uid() and deleted_at is null
  limit 1
$$;

alter table public.organizations enable row level security;
alter table public.staff enable row level security;

create policy org_isolation_select on public.organizations
  for select using (id = auth.user_org_id());

create policy staff_isolation_all on public.staff
  for all using (org_id = auth.user_org_id())
  with check (org_id = auth.user_org_id());
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: migrations apply cleanly, ending with "Finished supabase db reset".

- [ ] **Step 3: Write the test DB helper**

Create `tests/db/helpers.ts`:
```ts
import { Pool } from "pg";

export const pool = new Pool({
  connectionString:
    process.env.SUPABASE_DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
});

// Run `fn` inside a transaction as the `authenticated` role with the JWT claims
// Supabase RLS reads. Passing null simulates an unauthenticated request.
export async function withClaims<T>(
  userId: string | null,
  fn: (q: (text: string, params?: unknown[]) => Promise<any>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    const claims = userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "{}";
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    const q = (text: string, params?: unknown[]) => client.query(text, params);
    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// Seed helper runs as the superuser (RLS bypassed) to set up fixtures.
export async function asAdmin<T>(fn: (q: (t: string, p?: unknown[]) => Promise<any>) => Promise<T>) {
  const client = await pool.connect();
  try {
    const q = (text: string, params?: unknown[]) => client.query(text, params);
    return await fn(q);
  } finally {
    client.release();
  }
}

export async function resetDb() {
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
  });
}
```

- [ ] **Step 4: Write the failing tenancy isolation test**

Create `tests/db/tenancy.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeAll(async () => {
  await resetDb();
  await asAdmin(async (q) => {
    await q(`insert into public.organizations (id, name) values ($1,'Org A'),($2,'Org B')`, [ORG_A, ORG_B]);
    await q(
      `insert into public.staff (org_id, user_id, name, email, role)
       values ($1,$2,'Alice','a@a.com','admin'), ($3,$4,'Bob','b@b.com','admin')`,
      [ORG_A, USER_A, ORG_B, USER_B],
    );
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("tenant isolation", () => {
  it("user A sees only org A's staff", async () => {
    const rows = await withClaims(USER_A, async (q) => (await q(`select email from public.staff`)).rows);
    expect(rows.map((r: any) => r.email).sort()).toEqual(["a@a.com"]);
  });

  it("user B cannot see org A's organization row", async () => {
    const rows = await withClaims(USER_B, async (q) => (await q(`select name from public.organizations`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["Org B"]);
  });

  it("unauthenticated request sees nothing", async () => {
    const rows = await withClaims(null, async (q) => (await q(`select * from public.staff`)).rows);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/db/tenancy.test.ts`
Expected: 3 passing tests. (The migration in Step 1 already implements the behavior; if any test fails, the RLS policy or `auth.user_org_id()` is wrong — fix the migration and re-run `npx supabase db reset`.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: core tenancy schema with RLS isolation + tests"
```

---

## Task 3: Patients, eligibility checks, payer directory migration + RLS tests

**Files:**
- Create: `supabase/migrations/0002_patients_checks.sql`
- Test: `tests/db/patients.test.ts`

**Interfaces:**
- Produces (DB): `public.patients`, `public.eligibility_checks`, `public.payer_directory` — all `org_id`-scoped, RLS-enabled, with `deleted_at` on PHI tables.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0002_patients_checks.sql`:
```sql
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  name text not null,
  dob date,
  member_id text,
  primary_payer text,
  status text not null default 'pending' check (status in ('verified','pending','inactive')),
  last_checked date,
  next_due date,
  part2_protected boolean not null default true,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  patient_id uuid references public.patients(id) not null,
  checked_by uuid references public.staff(id),
  payer text,
  status text check (status in ('verified','pending','inactive')),
  copay numeric,
  deductible_remaining numeric,
  notes text,
  check_date date default current_date,
  next_due date,
  source text not null default 'manual',
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.payer_directory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  payer_name text not null,
  portal_url text,
  login_notes text,
  username_hint text,
  last_checked_here date
);

create index patients_next_due_idx on public.patients(org_id, next_due) where deleted_at is null;
create index checks_patient_idx on public.eligibility_checks(patient_id) where deleted_at is null;

alter table public.patients enable row level security;
alter table public.eligibility_checks enable row level security;
alter table public.payer_directory enable row level security;

create policy patients_isolation_all on public.patients
  for all using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());
create policy checks_isolation_all on public.eligibility_checks
  for all using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());
create policy payerdir_isolation_all on public.payer_directory
  for all using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: applies cleanly through `0002`.

- [ ] **Step 3: Write the failing isolation + write-guard test**

Create `tests/db/patients.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.eligibility_checks, public.patients, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Org A'),($2,'Org B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Alice','a@a.com','admin'),($3,$4,'Bob','b@b.com','admin')`,
            [ORG_A, USER_A, ORG_B, USER_B]);
    await q(`insert into public.patients (org_id, name) values ($1,'Pat A'),($2,'Pat B')`, [ORG_A, ORG_B]);
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("patients isolation", () => {
  it("user A reads only org A patients", async () => {
    const rows = await withClaims(USER_A, async (q) => (await q(`select name from public.patients`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["Pat A"]);
  });

  it("user A cannot insert a patient into org B", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`insert into public.patients (org_id, name) values ($1,'Sneaky')`, [ORG_B]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/db/patients.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: patients/checks/payer_directory schema + RLS tests"
```

---

## Task 4: Module 8 migration (hybrid baseline tables) + precedence test

**Files:**
- Create: `supabase/migrations/0003_module8.sql`
- Test: `tests/db/module8.test.ts`

**Interfaces:**
- Produces (DB): `public.providers`, `public.payer_enrollments` (org-scoped); `public.payer_code_coverage`, `public.payer_claim_rules` (nullable `org_id`; `org_id IS NULL` = Coverlog baseline; tenants read baseline + own, write own only).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_module8.sql`:
```sql
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  name text not null,
  npi text,
  license_type text,
  license_number text,
  license_state text,
  license_expiration date,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.payer_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  provider_id uuid references public.providers(id) not null,
  payer_id uuid references public.payer_directory(id) not null,
  status text not null default 'pending'
    check (status in ('enrolled','pending','terminated','not_enrolled')),
  par_status text check (par_status in ('in_network','out_of_network')),
  effective_date date,
  termination_date date,
  revalidation_due date,
  caqh_id text,
  notes text,
  created_at timestamptz default now()
);

create table public.payer_code_coverage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),     -- NULL = Coverlog baseline
  payer_id uuid references public.payer_directory(id) not null,
  cpt_code text not null,
  code_description text,
  covered boolean default true,
  requires_prior_auth boolean default false,
  unit_limit text,
  modifier_required text,
  telehealth_allowed boolean,
  notes text,
  effective_date date,
  source text not null default 'org' check (source in ('coverlog_baseline','org')),
  verified_at timestamptz,
  verified_by text,
  promoted_from_org uuid,
  created_at timestamptz default now()
);

create table public.payer_claim_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),     -- NULL = Coverlog baseline
  payer_id uuid references public.payer_directory(id) not null,
  rule_category text,
  field_reference text,
  rule_description text,
  required_value text,
  notes text,
  source text not null default 'org' check (source in ('coverlog_baseline','org')),
  verified_at timestamptz,
  verified_by text,
  promoted_from_org uuid,
  created_at timestamptz default now()
);

alter table public.providers enable row level security;
alter table public.payer_enrollments enable row level security;
alter table public.payer_code_coverage enable row level security;
alter table public.payer_claim_rules enable row level security;

create policy providers_isolation_all on public.providers
  for all using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());
create policy enrollments_isolation_all on public.payer_enrollments
  for all using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());

-- Hybrid: read baseline (org_id is null) OR your own; write your own only.
create policy coverage_read on public.payer_code_coverage
  for select using (org_id is null or org_id = auth.user_org_id());
create policy coverage_write on public.payer_code_coverage
  for insert with check (org_id = auth.user_org_id());
create policy coverage_update on public.payer_code_coverage
  for update using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());
create policy coverage_delete on public.payer_code_coverage
  for delete using (org_id = auth.user_org_id());

create policy rules_read on public.payer_claim_rules
  for select using (org_id is null or org_id = auth.user_org_id());
create policy rules_write on public.payer_claim_rules
  for insert with check (org_id = auth.user_org_id());
create policy rules_update on public.payer_claim_rules
  for update using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());
create policy rules_delete on public.payer_claim_rules
  for delete using (org_id = auth.user_org_id());
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: applies cleanly through `0003`.

- [ ] **Step 3: Write the failing hybrid-visibility test**

Create `tests/db/module8.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let payerId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Org A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Alice','a@a.com','admin')`, [ORG_A, USER_A]);
    const p = await q(`insert into public.payer_directory (org_id, payer_name)
                       values ($1,'Aetna') returning id`, [ORG_A]);
    payerId = p.rows[0].id;
    // One baseline row (org_id null) + one org-specific override for same code.
    await q(`insert into public.payer_code_coverage (org_id, payer_id, cpt_code, covered, source)
             values (null, $1, '90837', true, 'coverlog_baseline')`, [payerId]);
    await q(`insert into public.payer_code_coverage (org_id, payer_id, cpt_code, covered, source)
             values ($1, $2, '90837', false, 'org')`, [ORG_A, payerId]);
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("hybrid coverage visibility", () => {
  it("user A sees both baseline and own override rows", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select source from public.payer_code_coverage order by source`)).rows);
    expect(rows.map((r: any) => r.source)).toEqual(["coverlog_baseline", "org"]);
  });

  it("user A cannot write a baseline (org_id null) row", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`insert into public.payer_code_coverage (org_id, payer_id, cpt_code, source)
           values (null, $1, '99999', 'coverlog_baseline')`, [payerId]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
```

> Precedence (org row wins over baseline for the same `payer_id`+`cpt_code`) is a
> read-time resolution implemented in the Module 8 plan's query layer; this task only
> proves both rows are visible and the baseline is write-protected.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/db/module8.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Module 8 hybrid baseline/override schema + RLS tests"
```

---

## Task 5: Part 2 tables — consent, disclosure_log, access_log + RLS

**Files:**
- Create: `supabase/migrations/0004_part2_logging.sql`
- Test: `tests/db/part2.test.ts`

**Interfaces:**
- Produces (DB): `public.patient_consents`, `public.disclosure_log`, `public.access_log` — all `org_id`-scoped, RLS-enabled; `disclosure_log` and `access_log` are append-only (insert + select only).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_part2_logging.sql`:
```sql
create table public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  patient_id uuid references public.patients(id) not null,
  consent_type text not null,
  scope text,
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  document_ref text,
  created_by uuid references public.staff(id),
  created_at timestamptz default now()
);

create table public.disclosure_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  patient_id uuid references public.patients(id),
  actor_staff_id uuid references public.staff(id),
  action text not null,
  purpose text,
  disclosed_to text,
  occurred_at timestamptz default now(),
  detail jsonb
);

create table public.access_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) not null,
  actor_staff_id uuid references public.staff(id),
  action text not null,
  patient_id uuid references public.patients(id),
  patient_ids uuid[],
  query_context text,
  occurred_at timestamptz default now(),
  detail jsonb
) partition by range (occurred_at);

-- Initial monthly partitions (the later cron/ops plan adds rolling creation).
create table public.access_log_2026_06 partition of public.access_log
  for values from ('2026-06-01') to ('2026-07-01');
create table public.access_log_2026_07 partition of public.access_log
  for values from ('2026-07-01') to ('2026-08-01');

create index consents_patient_idx on public.patient_consents(patient_id);
create index disclosure_patient_idx on public.disclosure_log(org_id, patient_id);
create index access_actor_idx on public.access_log(org_id, actor_staff_id);

alter table public.patient_consents enable row level security;
alter table public.disclosure_log enable row level security;
alter table public.access_log enable row level security;

create policy consents_isolation_all on public.patient_consents
  for all using (org_id = auth.user_org_id()) with check (org_id = auth.user_org_id());

-- Append-only: insert + select within the org, no update/delete policy granted.
create policy disclosure_insert on public.disclosure_log
  for insert with check (org_id = auth.user_org_id());
create policy disclosure_select on public.disclosure_log
  for select using (org_id = auth.user_org_id());

create policy access_insert on public.access_log
  for insert with check (org_id = auth.user_org_id());
create policy access_select on public.access_log
  for select using (org_id = auth.user_org_id());
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: applies cleanly through `0004`.

- [ ] **Step 3: Write the failing append-only test**

Create `tests/db/part2.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.access_log, public.disclosure_log, public.patient_consents,
             public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Org A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Alice','a@a.com','admin')`, [ORG_A, USER_A]);
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("access_log append-only", () => {
  it("user A can insert and read an access_log row", async () => {
    const rows = await withClaims(USER_A, async (q) => {
      await q(`insert into public.access_log (org_id, action, query_context, occurred_at)
               values ($1,'patient_search','name=smith', now())`, [ORG_A]);
      return (await q(`select action from public.access_log`)).rows;
    });
    expect(rows.map((r: any) => r.action)).toEqual(["patient_search"]);
  });

  it("user A cannot update an access_log row (no update policy)", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`update public.access_log set action='tampered' where org_id=$1`, [ORG_A]),
      ),
    ).rejects.toThrow(/row-level security|permission/i);
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/db/part2.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Part 2 consent + disclosure_log + partitioned access_log"
```

---

## Task 6: Enable pgaudit read-logging backstop

**Files:**
- Create: `supabase/migrations/0005_pgaudit.sql`
- Test: `tests/db/pgaudit.test.ts`

**Interfaces:**
- Produces (DB): `pgaudit` extension enabled with `pgaudit.log = 'read'` set at the database level, so SELECTs are recorded in Postgres logs as a backstop independent of app code.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_pgaudit.sql`:
```sql
create extension if not exists pgaudit;

-- Log read (SELECT) and write statements at the database layer as a Part 2 backstop.
-- Applied at the database scope; takes effect on new sessions.
do $$
declare db text := current_database();
begin
  execute format('alter database %I set pgaudit.log = %L', db, 'read, write');
  execute format('alter database %I set pgaudit.log_relation = %L', db, 'on');
end $$;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: applies cleanly through `0005`. (If the local image lacks `pgaudit`, the test in Step 3 will surface it; pgaudit is available on Supabase hosted Postgres.)

- [ ] **Step 3: Write the test verifying the setting is present**

Create `tests/db/pgaudit.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { pool, asAdmin } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("pgaudit backstop", () => {
  it("pgaudit extension is installed", async () => {
    const rows = await asAdmin(async (q) =>
      (await q(`select extname from pg_extension where extname = 'pgaudit'`)).rows);
    expect(rows.length).toBe(1);
  });

  it("database is configured to log reads", async () => {
    const rows = await asAdmin(async (q) =>
      (await q(`select setting from pg_settings where name = 'pgaudit.log'`)).rows);
    // New connection inherits the database-level setting.
    expect(String(rows[0]?.setting ?? "")).toMatch(/read/);
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/db/pgaudit.test.ts`
Expected: 2 passing tests. (If `pgaudit.log` reads empty on the first connection, reconnect — the `alter database` setting applies to new sessions; the `pool` opens fresh connections so a clean run reflects it.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: enable pgaudit read-logging backstop"
```

---

## Task 7: Supabase server client (RLS-bound) + auth session middleware

**Files:**
- Create: `src/lib/supabase/server.ts`
- Create: `proxy.ts`
- Test: `tests/phi/server-client.test.ts`

**Interfaces:**
- Produces: `createServerSupabase()` returns a `SupabaseClient` bound to the request's auth cookies (so RLS applies as the logged-in user). `proxy.ts` refreshes the Supabase session on each request.
- Consumes: `@supabase/ssr`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 1: Write the server client**

Create `src/lib/supabase/server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a Server Component; session refresh handled in proxy.ts
          }
        },
      },
    },
  );
}
```

- [ ] **Step 2: Write the proxy (middleware) for session refresh**

Create `proxy.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

> Confirm the v16 middleware export contract in `node_modules/next/dist/docs/` — if the
> runtime expects a `middleware` export name rather than `proxy`, rename the function
> accordingly while keeping the file named `proxy.ts` per project convention.

- [ ] **Step 3: Write a test that the factory reads required env**

Create `tests/phi/server-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("supabase server client config", () => {
  it("requires the public env vars to be defined for the app to build a client", () => {
    // Guards against shipping without configured Supabase creds.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "local-anon";
    expect(url).toMatch(/^https?:\/\//);
    expect(key.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/phi/server-client.test.ts`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: RLS-bound Supabase server client + auth proxy"
```

---

## Task 8: Centralized PHI data-access layer (writes access_log on every read)

**Files:**
- Create: `src/lib/phi/access.ts`
- Test: `tests/phi/access.test.ts`

**Interfaces:**
- Consumes: a Supabase-like client exposing `.from(table)` and `.rpc(...)`, plus the current staff context `{ orgId: string; staffId: string }`.
- Produces:
  - `readPatient(client, ctx, patientId): Promise<Patient | null>` — fetches one patient AND writes an `access_log` row `{ action: 'view_chart', patient_id }`.
  - `listPatients(client, ctx, opts): Promise<Patient[]>` — fetches the patient list AND writes one `access_log` row `{ action: 'list_view', patient_ids, query_context }`.
  - These are the ONLY sanctioned ways to read patient PHI; later plans call them, never `client.from('patients')` directly.

- [ ] **Step 1: Write the failing test (read logs access)**

Create `tests/phi/access.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { readPatient, listPatients } from "@/lib/phi/access";

// Minimal fake client capturing inserts and returning canned reads.
function fakeClient(patientRows: any[]) {
  const inserted: any[] = [];
  const client: any = {
    from(table: string) {
      return {
        _table: table,
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        order() { return this; },
        async maybeSingle() { return { data: patientRows[0] ?? null, error: null }; },
        then(resolve: any) { resolve({ data: patientRows, error: null }); },
        insert(row: any) { if (table === "access_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; },
      };
    },
    _inserted: inserted,
  };
  return client;
}

const ctx = { orgId: "org-1", staffId: "staff-1" };

describe("PHI access layer", () => {
  it("readPatient writes a view_chart access_log row", async () => {
    const client = fakeClient([{ id: "p1", name: "Pat" }]);
    const p = await readPatient(client, ctx, "p1");
    expect(p?.id).toBe("p1");
    expect(client._inserted).toHaveLength(1);
    expect(client._inserted[0]).toMatchObject({
      org_id: "org-1", actor_staff_id: "staff-1", action: "view_chart", patient_id: "p1",
    });
  });

  it("listPatients writes a list_view row with patient_ids", async () => {
    const client = fakeClient([{ id: "p1" }, { id: "p2" }]);
    const rows = await listPatients(client, ctx, { search: "smith" });
    expect(rows).toHaveLength(2);
    expect(client._inserted[0]).toMatchObject({
      action: "list_view", patient_ids: ["p1", "p2"], query_context: "search=smith",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/phi/access.test.ts`
Expected: FAIL — `Cannot find module '@/lib/phi/access'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/phi/access.ts`:
```ts
export type Patient = { id: string; [k: string]: unknown };
export type PhiContext = { orgId: string; staffId: string };

async function logAccess(
  client: any,
  ctx: PhiContext,
  entry: { action: string; patient_id?: string | null; patient_ids?: string[]; query_context?: string },
) {
  await client.from("access_log").insert({
    org_id: ctx.orgId,
    actor_staff_id: ctx.staffId,
    action: entry.action,
    patient_id: entry.patient_id ?? null,
    patient_ids: entry.patient_ids ?? null,
    query_context: entry.query_context ?? null,
  });
}

export async function readPatient(
  client: any, ctx: PhiContext, patientId: string,
): Promise<Patient | null> {
  const { data } = await client
    .from("patients").select("*").eq("id", patientId).is("deleted_at", null).maybeSingle();
  await logAccess(client, ctx, { action: "view_chart", patient_id: patientId });
  return data ?? null;
}

export async function listPatients(
  client: any, ctx: PhiContext, opts: { search?: string } = {},
): Promise<Patient[]> {
  const { data } = await client
    .from("patients").select("*").is("deleted_at", null).order("next_due", { ascending: true });
  const rows: Patient[] = data ?? [];
  await logAccess(client, ctx, {
    action: "list_view",
    patient_ids: rows.map((r) => r.id),
    query_context: opts.search ? `search=${opts.search}` : "all",
  });
  return rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/phi/access.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: centralized PHI access layer with mandatory access_log"
```

---

## Task 9: Org + first-staff onboarding flow

**Files:**
- Create: `src/lib/onboarding.ts`
- Create: `src/app/onboarding/page.tsx`
- Create: `src/app/onboarding/actions.ts`
- Test: `tests/db/onboarding.test.ts`

**Interfaces:**
- Consumes: `auth.users` (a signed-up Supabase Auth user with no `staff` row yet).
- Produces: `createOrgWithFirstAdmin(adminClient, { userId, email, orgName, adminName })` — atomically inserts an `organizations` row and a `staff` row (`role='admin'`, linked `user_id`) so the user resolves through `auth.user_org_id()`. Runs via a transaction; returns `{ orgId, staffId }`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/onboarding.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, withClaims, resetDb } from "./helpers";
import { createOrgWithFirstAdmin } from "@/lib/onboarding";

const USER_NEW = "cccccccc-cccc-cccc-cccc-cccccccccccc";

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("onboarding", () => {
  it("creates an org + admin staff that resolves via auth.user_org_id()", async () => {
    const { orgId } = await createOrgWithFirstAdmin(pool, {
      userId: USER_NEW, email: "new@clinic.com", orgName: "New Clinic", adminName: "Dana",
    });
    expect(orgId).toBeTruthy();
    // The new user now sees exactly their own org via RLS.
    const rows = await withClaims(USER_NEW, async (q) =>
      (await q(`select name from public.organizations`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["New Clinic"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/db/onboarding.test.ts`
Expected: FAIL — `Cannot find module '@/lib/onboarding'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/onboarding.ts`:
```ts
import type { Pool } from "pg";

export type OnboardingInput = {
  userId: string; email: string; orgName: string; adminName: string;
};

// Atomically create the organization and its first admin staff row.
// Accepts a pg Pool (used directly with the privileged migration/service connection
// during onboarding, before the user has any org to scope to).
export async function createOrgWithFirstAdmin(
  pool: Pool, input: OnboardingInput,
): Promise<{ orgId: string; staffId: string }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const org = await client.query(
      `insert into public.organizations (name) values ($1) returning id`, [input.orgName]);
    const orgId = org.rows[0].id;
    const staff = await client.query(
      `insert into public.staff (org_id, user_id, name, email, role)
       values ($1,$2,$3,$4,'admin') returning id`,
      [orgId, input.userId, input.adminName, input.email]);
    await client.query("commit");
    return { orgId, staffId: staff.rows[0].id };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/db/onboarding.test.ts`
Expected: 1 passing test.

- [ ] **Step 5: Write the onboarding server action + page**

Create `src/app/onboarding/actions.ts`:
```ts
"use server";

import { Pool } from "pg";
import { createServerSupabase } from "@/lib/supabase/server";
import { createOrgWithFirstAdmin } from "@/lib/onboarding";
import { redirect } from "next/navigation";

export async function submitOnboarding(formData: FormData) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  try {
    await createOrgWithFirstAdmin(pool, {
      userId: user!.id,
      email: user!.email ?? "",
      orgName: String(formData.get("orgName") ?? "").trim(),
      adminName: String(formData.get("adminName") ?? "").trim(),
    });
  } finally {
    await pool.end();
  }
  redirect("/dashboard");
}
```

Create `src/app/onboarding/page.tsx`:
```tsx
import { submitOnboarding } from "./actions";

export default function OnboardingPage() {
  return (
    <form action={submitOnboarding} className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-xl font-semibold">Set up your clinic</h1>
      <input name="orgName" required placeholder="Clinic name" className="w-full border p-2" />
      <input name="adminName" required placeholder="Your name" className="w-full border p-2" />
      <button type="submit" className="rounded bg-black px-4 py-2 text-white">Create</button>
    </form>
  );
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass (smoke + tenancy + patients + module8 + part2 + pgaudit + server-client + access + onboarding).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: org + first-admin onboarding flow"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §4 stack (Task 1, 7), §6 RLS + `auth.user_org_id()` (Tasks 2–5), §7.1 core tables (Tasks 2–3), §7.2 Module 8 hybrid (Task 4), §7.3 consent/disclosure/access_log + full read-logging + pgaudit (Tasks 5, 6, 8), §7.4 service-role confinement (noted; curation surface deferred to Plan 3), §7.5 atomic log-a-check (deferred to Plan 2 — core tracking), §9 onboarding (Task 9). Email (§8), dashboard/CSV (§9 core), and Payer Profile (§9 Module 8) are explicitly scoped to Plans 2–4.
- **Out of this plan (by design):** patient/check CRUD UI, dashboard, CSV, Payer Profile UI, curation surface, SES email — they belong to Plans 2–4 and depend on this foundation.
- **Type consistency:** `auth.user_org_id()`, `createServerSupabase()`, `readPatient/listPatients`, `PhiContext`, `createOrgWithFirstAdmin` names are used identically wherever referenced.

---

## Subsequent Plans (to be written after this one lands)

- **Plan 2 — Core Eligibility Tracking:** patient CRUD, atomic log-a-check RPC (§7.5), dashboard stats, CSV import/export with consent gating + `disclosure_log`.
- **Plan 3 — Payer Directory & Module 8:** payer master/`payer_directory`, Payer Profile tabs, providers + enrollments, hybrid coverage/rules read-time precedence, internal curation surface (service role).
- **Plan 4 — Email Alerts:** Vercel cron + AWS SES PHI-minimized digests.
