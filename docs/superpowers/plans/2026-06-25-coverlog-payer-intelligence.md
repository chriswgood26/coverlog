# Coverlog Payer Intelligence (Module 8a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the payer directory into a real payer profile: a canonical `payer_master`, per-org payer linkage, and a hybrid (Coverlog-baseline + per-org-override) lookup of CPT/HCPCS code coverage and CMS-1500 claim rules — surfaced as a tabbed Payer Profile and curated through an internal-only surface.

**Architecture:** A global, Coverlog-curated `payer_master` table is the canonical payer identity. The shared baseline rows in `payer_code_coverage`/`payer_claim_rules` (`org_id IS NULL`) and each org's override rows both key on `payer_master_id`; a resolution layer merges them with **org-row-wins** precedence and a provenance label. Tenants read baseline+own via RLS and write only their own; the baseline + payer_master are written only by an internal curation surface using the service role (off the tenant request path). UI is thin server components over tested libs. This is plan 3 of the Module 8 arc (3a payer intelligence → 3b credentialing → 3c consent admin).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind 4, Supabase (Postgres + Auth, `@supabase/ssr`), Vitest, `pg` (DB/RLS integration tests).

## Global Constraints

- **Next.js 16 App Router.** Middleware is `proxy.ts`. Server components by default; `"use client"` only when needed. Pages calling Supabase set `export const dynamic = "force-dynamic"`.
- **TypeScript strict.** Path alias `@/*` → `./src/*`.
- **Multi-tenancy:** every query runs RLS-scoped as `authenticated`; never the service role on a tenant request path. `org_id` never from client input — always `public.user_org_id()` / resolved context.
- **Hybrid model (decided):** canonical `payer_master` is global (`org_id IS NULL`, Coverlog-curated). Baseline coverage/claim rows (`org_id IS NULL`) and org overrides both reference `payer_master_id`. **Org row wins** over baseline for the same `(payer_master_id, cpt_code)` (coverage) or `(payer_master_id, rule_category, field_reference)` (claim rules). UI shows provenance: *Coverlog baseline* vs *Your clinic's override*.
- **Curation is service-role only**, in a route segment gated to internal Coverlog staff, never reachable by tenants. It is the only writer of `payer_master` rows and `org_id IS NULL` baseline rows.
- **42 CFR Part 2 / PHI:** payer intelligence is payer-level reference data, NOT patient PHI — it does not go through the access_log layer. BUT when cross-referencing a *patient's* `primary_payer` on a chart, the patient read still goes through `src/lib/phi/access.ts` (unchanged).
- **Migrations** continue at `0010`+; apply with `npm run db:reset`; tests auto-load `.env.local` and run serially (`fileParallelism:false`).
- Status/source enums already exist from Plan 1's `0003`: `payer_code_coverage.source` / `payer_claim_rules.source` ∈ `coverlog_baseline | org`.

## Foundation this plan builds on (already merged)

- Migration `0003` created `payer_directory` (org-scoped: org_id NOT NULL, payer_name, portal_url, login_notes, username_hint, last_checked_here), `payer_code_coverage` and `payer_claim_rules` (both: nullable `org_id`, `payer_id uuid references payer_directory(id) not null`, `source`, `verified_at`, `verified_by`, `promoted_from_org`) with hybrid RLS (read `org_id IS NULL OR = user_org_id()`; write `org_id = user_org_id()` only).
- `public.user_org_id()`, `getStaffContext`, `createServerSupabase`, test helpers (`withClaims`/`asAdmin`/`resetDb`), `npm run db:reset`.

> **Schema reality this plan corrects:** in `0003`, baseline coverage/claim rows reference `payer_directory(id)` — but `payer_directory` is per-org, so a global baseline row can't coherently point at one tenant's payer. Task 1 repoints both tables at `payer_master`.

---

## File Structure

- `supabase/migrations/0010_payer_master.sql` — `payer_master` table + RLS; `payer_directory.payer_master_id`; repoint `payer_code_coverage`/`payer_claim_rules` to `payer_master_id`.
- `src/lib/payers/resolve.ts` — `resolveCoverage`, `resolveClaimRules` (merge baseline+org with org-wins precedence + provenance).
- `src/lib/payers/mutations.ts` — org-override writes: `upsertOrgCoverage`, `upsertOrgClaimRule`, `linkPayerToMaster`.
- `src/lib/payers/curation.ts` — service-role baseline writers: `upsertMasterPayer`, `upsertBaselineCoverage`, `upsertBaselineClaimRule`.
- `src/app/(app)/payers/page.tsx` — payer list (org payer_directory joined to master).
- `src/app/(app)/payers/[id]/page.tsx` — tabbed Payer Profile (Portal Access · Covered Codes · Claim Rules).
- `src/app/(app)/payers/[id]/_components/` — tab components + org-override forms.
- `src/app/(app)/payers/actions.ts` — server actions for org overrides + linking.
- `src/app/internal/curation/` — internal-only curation surface (service-role; gated).
- Tests under `tests/db/**` (RLS/precedence integration) and `tests/lib/**` (resolution units).

---

## Task 1: payer_master + repoint coverage/claim-rule FKs

**Files:**
- Create: `supabase/migrations/0010_payer_master.sql`
- Test: `tests/db/payer-master.test.ts`

**Interfaces:**
- Produces (DB): `public.payer_master(id, name, payer_type, created_at)` — global (no `org_id`), RLS: every authenticated tenant may SELECT; INSERT/UPDATE/DELETE denied to `anon`/`authenticated` (curation uses service role, which bypasses RLS). `payer_directory.payer_master_id uuid references payer_master(id)` (nullable — local-only payers allowed). `payer_code_coverage` and `payer_claim_rules`: column `payer_id` renamed to `payer_master_id`, now `references payer_master(id)`. Existing hybrid RLS on those two tables is unchanged.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_payer_master.sql`:
```sql
-- Canonical, Coverlog-curated payer identity. Global (no org_id): every tenant
-- reads the same master list; only the service-role curation surface writes it.
create table public.payer_master (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  payer_type text,                         -- e.g. 'medicaid' | 'medicare' | 'commercial'
  created_at timestamptz default now()
);

alter table public.payer_master enable row level security;

-- Every authenticated tenant may read the master list. No write policy for
-- anon/authenticated → inserts/updates/deletes are denied for them; the curation
-- surface writes via the service role (which bypasses RLS).
create policy payer_master_read on public.payer_master
  for select to authenticated using (true);

-- Tenants must hold the base grant for RLS to even be evaluated (Plan 1 db-reset
-- no longer grants tenant roles broadly by default).
grant select on public.payer_master to authenticated;
revoke all on public.payer_master from anon;

-- Link each org's payer_directory row to a canonical payer (nullable: an org may
-- track a local-only payer not yet in master).
alter table public.payer_directory
  add column payer_master_id uuid references public.payer_master(id);

-- Repoint baseline + override coverage/claim rows at the canonical payer.
-- (0003 pointed these at the per-org payer_directory, which cannot key a global baseline.)
alter table public.payer_code_coverage drop constraint payer_code_coverage_payer_id_fkey;
alter table public.payer_code_coverage rename column payer_id to payer_master_id;
alter table public.payer_code_coverage
  add constraint payer_code_coverage_payer_master_id_fkey
  foreign key (payer_master_id) references public.payer_master(id);

alter table public.payer_claim_rules drop constraint payer_claim_rules_payer_id_fkey;
alter table public.payer_claim_rules rename column payer_id to payer_master_id;
alter table public.payer_claim_rules
  add constraint payer_claim_rules_payer_master_id_fkey
  foreign key (payer_master_id) references public.payer_master(id);

create index coverage_payer_idx on public.payer_code_coverage(payer_master_id, cpt_code);
create index claimrules_payer_idx on public.payer_claim_rules(payer_master_id, rule_category);
```

> The FK constraint names (`payer_code_coverage_payer_id_fkey`, `payer_claim_rules_payer_id_fkey`) are Postgres's default names for the `payer_id` FKs created in `0003`. If `db:reset` reports a different constraint name, look it up with `\d public.payer_code_coverage` and use the reported name.

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: applies cleanly through `0010`. If a `drop constraint` fails on an unexpected name, correct the name per the note above and re-run.

- [ ] **Step 3: Write the failing test**

Create `tests/db/payer-master.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let masterId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_claim_rules,
             public.payer_directory, public.payer_master, public.staff, public.organizations
             restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    const m = await q(`insert into public.payer_master (name, payer_type)
                       values ('Aetna','commercial') returning id`);
    masterId = m.rows[0].id;
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_master restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("payer_master", () => {
  it("authenticated tenants can read the master list", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select name from public.payer_master`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["Aetna"]);
  });

  it("authenticated tenants CANNOT insert a master payer (curation-only)", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`insert into public.payer_master (name) values ('Rogue')`)),
    ).rejects.toThrow(/row-level security|permission/i);
  });

  it("coverage rows now key on payer_master_id", async () => {
    await withClaims(USER_A, async (q) =>
      q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, source)
         values (public.user_org_id(), $1, '90837', 'org')`, [masterId]));
    const rows = await asAdmin(async (q) =>
      (await q(`select cpt_code from public.payer_code_coverage where payer_master_id=$1`, [masterId])).rows);
    expect(rows.map((r: any) => r.cpt_code)).toEqual(["90837"]);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/db/payer-master.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_payer_master.sql tests/db/payer-master.test.ts
git commit -m "feat: canonical payer_master + repoint coverage/claim-rule FKs"
```

---

## Task 2: Hybrid precedence resolution layer

**Files:**
- Create: `src/lib/payers/resolve.ts`
- Test: `tests/db/payer-resolve.test.ts`

**Interfaces:**
- Produces:
  - `resolveCoverage(client, payerMasterId): Promise<ResolvedCoverage[]>` — returns one row per `cpt_code` for the payer, choosing the org override when present else the baseline, each tagged `provenance: "org" | "coverlog_baseline"`.
  - `resolveClaimRules(client, payerMasterId): Promise<ResolvedClaimRule[]>` — one row per `(rule_category, field_reference)`, org-wins, same provenance tag.
  - Types `ResolvedCoverage = { cpt_code: string; covered: boolean; requires_prior_auth: boolean; modifier_required: string|null; telehealth_allowed: boolean|null; unit_limit: string|null; notes: string|null; provenance: "org"|"coverlog_baseline" }` and `ResolvedClaimRule = { rule_category: string|null; field_reference: string|null; rule_description: string|null; required_value: string|null; notes: string|null; provenance: "org"|"coverlog_baseline" }`.
- Reads go through the RLS-bound client (which already returns baseline + own-org rows); precedence is resolved in JS.

- [ ] **Step 1: Write the failing test**

Create `tests/db/payer-resolve.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { resolveCoverage } from "@/lib/payers/resolve";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let masterId: string;
let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  const { data: created } = await admin.auth.admin.createUser({
    email: "payer-resolve-it@example.com", password: "Test-Passw0rd!", email_confirm: true,
  });
  const userId = created!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_directory,
             public.payer_master, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, userId]);
    const m = await q(`insert into public.payer_master (name) values ('Aetna') returning id`);
    masterId = m.rows[0].id;
    // Baseline covers 90837 and 90834; org overrides ONLY 90837 (covered=false).
    await q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, covered, source)
             values (null,$1,'90837',true,'coverlog_baseline'),
                    (null,$1,'90834',true,'coverlog_baseline'),
                    ($2,$1,'90837',false,'org')`, [masterId, ORG_A]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "payer-resolve-it@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser((await admin.auth.admin.listUsers()).data.users.find(u => u.email === "payer-resolve-it@example.com")!.id);
  await asAdmin((q) => q(`truncate table public.payer_master restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("resolveCoverage precedence", () => {
  it("org override wins for 90837; baseline shows for 90834", async () => {
    const rows = await resolveCoverage(userClient, masterId);
    const byCode = Object.fromEntries(rows.map(r => [r.cpt_code, r]));
    expect(byCode["90837"].covered).toBe(false);
    expect(byCode["90837"].provenance).toBe("org");
    expect(byCode["90834"].covered).toBe(true);
    expect(byCode["90834"].provenance).toBe("coverlog_baseline");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/payer-resolve.test.ts`
Expected: FAIL — `Cannot find module '@/lib/payers/resolve'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/payers/resolve.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolvedCoverage = {
  cpt_code: string; covered: boolean; requires_prior_auth: boolean;
  modifier_required: string | null; telehealth_allowed: boolean | null;
  unit_limit: string | null; notes: string | null;
  provenance: "org" | "coverlog_baseline";
};
export type ResolvedClaimRule = {
  rule_category: string | null; field_reference: string | null;
  rule_description: string | null; required_value: string | null;
  notes: string | null; provenance: "org" | "coverlog_baseline";
};

// Merge baseline (org_id null) + org rows; the org row wins per key. The RLS-bound
// client already returns only baseline + this org's rows, so org_id non-null = "org".
function mergeByKey<T extends { org_id: string | null }>(
  rows: T[], keyOf: (r: T) => string,
): Array<T & { provenance: "org" | "coverlog_baseline" }> {
  const byKey = new Map<string, T & { provenance: "org" | "coverlog_baseline" }>();
  for (const r of rows) {
    const key = keyOf(r);
    const tagged = { ...r, provenance: (r.org_id ? "org" : "coverlog_baseline") as "org" | "coverlog_baseline" };
    const existing = byKey.get(key);
    // Org row (org_id non-null) always wins over a baseline row for the same key.
    if (!existing || (tagged.provenance === "org" && existing.provenance === "coverlog_baseline")) {
      byKey.set(key, tagged);
    }
  }
  return [...byKey.values()];
}

export async function resolveCoverage(
  client: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<ResolvedCoverage[]> {
  const { data, error } = await client
    .from("payer_code_coverage").select("*").eq("payer_master_id", payerMasterId);
  if (error) throw new Error(`resolveCoverage failed: ${error.message}`);
  const merged = mergeByKey(data ?? [], (r: any) => r.cpt_code);
  return merged.map((r: any) => ({
    cpt_code: r.cpt_code, covered: r.covered, requires_prior_auth: r.requires_prior_auth,
    modifier_required: r.modifier_required, telehealth_allowed: r.telehealth_allowed,
    unit_limit: r.unit_limit, notes: r.notes, provenance: r.provenance,
  })).sort((a, b) => a.cpt_code.localeCompare(b.cpt_code));
}

export async function resolveClaimRules(
  client: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<ResolvedClaimRule[]> {
  const { data, error } = await client
    .from("payer_claim_rules").select("*").eq("payer_master_id", payerMasterId);
  if (error) throw new Error(`resolveClaimRules failed: ${error.message}`);
  const merged = mergeByKey(data ?? [], (r: any) => `${r.rule_category}|${r.field_reference}`);
  return merged.map((r: any) => ({
    rule_category: r.rule_category, field_reference: r.field_reference,
    rule_description: r.rule_description, required_value: r.required_value,
    notes: r.notes, provenance: r.provenance,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/payer-resolve.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Add a fake-client unit test for the merge precedence**

Create `tests/lib/payer-resolve.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveCoverage } from "@/lib/payers/resolve";

function client(rows: any[]) {
  return { from: () => ({ select() { return this; }, eq() { return this; },
    then(r: any) { r({ data: rows, error: null }); } }) } as any;
}

describe("resolveCoverage merge (unit)", () => {
  it("org row wins over baseline for the same cpt_code regardless of row order", async () => {
    const rows = [
      { org_id: "o1", payer_master_id: "m1", cpt_code: "90837", covered: false, requires_prior_auth: false, modifier_required: null, telehealth_allowed: null, unit_limit: null, notes: null },
      { org_id: null, payer_master_id: "m1", cpt_code: "90837", covered: true, requires_prior_auth: true, modifier_required: "HE", telehealth_allowed: true, unit_limit: null, notes: null },
    ];
    const out = await resolveCoverage(client(rows), "m1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cpt_code: "90837", covered: false, provenance: "org" });
  });
});
```

- [ ] **Step 6: Run both files**

Run: `npm test -- tests/db/payer-resolve.test.ts tests/lib/payer-resolve.test.ts`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/payers/resolve.ts tests/db/payer-resolve.test.ts tests/lib/payer-resolve.test.ts
git commit -m "feat: hybrid coverage/claim-rule resolution (org-wins precedence + provenance)"
```

---

## Task 3: Org-override mutations + payer linking

**Files:**
- Create: `src/lib/payers/mutations.ts`
- Test: `tests/db/payer-mutations.test.ts`

**Interfaces:**
- Produces (all RLS-scoped; `org_id` from `ctx.orgId`):
  - `upsertOrgCoverage(client, ctx, input)` where `input = { payerMasterId, cptCode, covered, requiresPriorAuth?, modifierRequired?, telehealthAllowed?, unitLimit?, notes? }` → inserts/updates this org's `payer_code_coverage` row (`source='org'`).
  - `upsertOrgClaimRule(client, ctx, input)` where `input = { payerMasterId, ruleCategory, fieldReference?, ruleDescription?, requiredValue?, notes? }` → this org's `payer_claim_rules` row (`source='org'`).
  - `linkPayerToMaster(client, ctx, payerDirectoryId, payerMasterId)` → sets `payer_directory.payer_master_id` for one of this org's payers.
- `StaffContext` from `@/lib/auth/context`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/payer-mutations.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { upsertOrgCoverage } from "@/lib/payers/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let masterId: string; let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  const { data: created } = await admin.auth.admin.createUser({
    email: "payer-mut-it@example.com", password: "Test-Passw0rd!", email_confirm: true });
  const userId = created!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_master,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, userId]);
    const m = await q(`insert into public.payer_master (name) values ('Aetna') returning id`);
    masterId = m.rows[0].id;
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "payer-mut-it@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser((await admin.auth.admin.listUsers()).data.users.find(u => u.email === "payer-mut-it@example.com")!.id);
  await asAdmin((q) => q(`truncate table public.payer_master restart identity cascade`));
  await resetDb(); await pool.end();
});

describe("upsertOrgCoverage", () => {
  it("writes an org coverage row scoped to the caller's org", async () => {
    await upsertOrgCoverage(userClient, { orgId: ORG_A, staffId: "s", role: "admin" },
      { payerMasterId: masterId, cptCode: "90837", covered: false, modifierRequired: "HE" });
    const rows = await asAdmin(async (q) =>
      (await q(`select org_id, cpt_code, covered, modifier_required, source
                from public.payer_code_coverage where payer_master_id=$1`, [masterId])).rows);
    expect(rows[0]).toMatchObject({ org_id: ORG_A, cpt_code: "90837", covered: false,
      modifier_required: "HE", source: "org" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/payer-mutations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/payers/mutations.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

export type OrgCoverageInput = {
  payerMasterId: string; cptCode: string; covered: boolean;
  requiresPriorAuth?: boolean; modifierRequired?: string;
  telehealthAllowed?: boolean; unitLimit?: string; notes?: string;
};
export type OrgClaimRuleInput = {
  payerMasterId: string; ruleCategory: string; fieldReference?: string;
  ruleDescription?: string; requiredValue?: string; notes?: string;
};

export async function upsertOrgCoverage(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: OrgCoverageInput,
): Promise<void> {
  const { error } = await client.from("payer_code_coverage").upsert({
    org_id: ctx.orgId, payer_master_id: input.payerMasterId, cpt_code: input.cptCode,
    covered: input.covered, requires_prior_auth: input.requiresPriorAuth ?? false,
    modifier_required: input.modifierRequired ?? null,
    telehealth_allowed: input.telehealthAllowed ?? null,
    unit_limit: input.unitLimit ?? null, notes: input.notes ?? null, source: "org",
  }, { onConflict: "org_id,payer_master_id,cpt_code" });
  if (error) throw new Error(`upsertOrgCoverage failed: ${error.message}`);
}

export async function upsertOrgClaimRule(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: OrgClaimRuleInput,
): Promise<void> {
  const { error } = await client.from("payer_claim_rules").upsert({
    org_id: ctx.orgId, payer_master_id: input.payerMasterId, rule_category: input.ruleCategory,
    field_reference: input.fieldReference ?? null, rule_description: input.ruleDescription ?? null,
    required_value: input.requiredValue ?? null, notes: input.notes ?? null, source: "org",
  }, { onConflict: "org_id,payer_master_id,rule_category,field_reference" });
  if (error) throw new Error(`upsertOrgClaimRule failed: ${error.message}`);
}

export async function linkPayerToMaster(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext,
  payerDirectoryId: string, payerMasterId: string,
): Promise<void> {
  const { error } = await client.from("payer_directory")
    .update({ payer_master_id: payerMasterId })
    .eq("id", payerDirectoryId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`linkPayerToMaster failed: ${error.message}`);
}
```

- [ ] **Step 4: Add the upsert unique indexes (the `onConflict` targets must exist)**

The `upsert` calls target `(org_id, payer_master_id, cpt_code)` and `(org_id, payer_master_id, rule_category, field_reference)`. Add a migration `supabase/migrations/0011_payer_override_unique.sql`:
```sql
-- Unique per-org override keys so upsert (insert-or-update) is well-defined.
-- Partial: only org rows (org_id not null) are unique-constrained; baseline rows
-- (org_id null, curation-managed) are not.
create unique index org_coverage_unique
  on public.payer_code_coverage (org_id, payer_master_id, cpt_code)
  where org_id is not null;
create unique index org_claimrule_unique
  on public.payer_claim_rules (org_id, payer_master_id, rule_category, field_reference)
  where org_id is not null;
```
> **Two issues forced the final form below.** (1) A *partial* unique index supports `ON CONFLICT` only with a matching `WHERE`, which supabase-js cannot emit — so the indexes must be **full** (no `where org_id is not null`). (2) Baseline rows (Task 4) have `org_id IS NULL`; under Postgres's default `NULLS DISTINCT`, two NULL `org_id`s never conflict, so a baseline upsert's `ON CONFLICT` would never match and re-curation would insert **duplicate** baseline rows. Postgres 17 fixes this with **`NULLS NOT DISTINCT`**, which makes NULL `org_id`s collide (so baseline upserts update in place) while distinct org UUIDs still behave normally. Use exactly:
```sql
create unique index org_coverage_unique
  on public.payer_code_coverage (org_id, payer_master_id, cpt_code) nulls not distinct;
create unique index org_claimrule_unique
  on public.payer_claim_rules (org_id, payer_master_id, rule_category, field_reference) nulls not distinct;
```
Apply: `npm run db:reset`. (These same indexes serve BOTH the Task 3 org-override upserts and the Task 4 baseline upserts — Postgres matches `ON CONFLICT` to a unique index by column *set*, order-independent.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- tests/db/payer-mutations.test.ts`
Expected: 1 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payers/mutations.ts supabase/migrations/0011_payer_override_unique.sql tests/db/payer-mutations.test.ts
git commit -m "feat: org-override coverage/claim-rule upserts + payer linking"
```

---

## Task 4: Internal curation surface (service-role baseline writers)

**Files:**
- Create: `src/lib/payers/curation.ts`
- Create: `src/lib/supabase/service.ts` (service-role client factory — internal use only)
- Test: `tests/db/curation.test.ts`

**Interfaces:**
- Produces:
  - `createServiceSupabase()` in `src/lib/supabase/service.ts` — a Supabase client built with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). **Only imported by curation code / internal routes — never by tenant pages or actions.**
  - `upsertMasterPayer(serviceClient, { name, payerType? })` → returns `{ id }`.
  - `upsertBaselineCoverage(serviceClient, input)` → writes an `org_id IS NULL`, `source='coverlog_baseline'` row.
  - `upsertBaselineClaimRule(serviceClient, input)` → baseline claim rule row.

- [ ] **Step 1: Write the service-role client factory**

Create `src/lib/supabase/service.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

// Service-role client — BYPASSES RLS. Internal curation / admin use ONLY.
// NEVER import this from a tenant-facing page, server action, or component.
export function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/curation.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { asAdmin, pool, resetDb } from "./helpers";
import { createServiceSupabase } from "@/lib/supabase/service";
import { upsertMasterPayer, upsertBaselineCoverage } from "@/lib/payers/curation";

const svc = createServiceSupabase();

beforeAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_master
                          restart identity cascade`));
});
afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_master
                          restart identity cascade`));
  await resetDb(); await pool.end();
});

describe("curation (service role)", () => {
  it("creates a master payer and a baseline coverage row (org_id null)", async () => {
    const { id } = await upsertMasterPayer(svc, { name: "Cigna", payerType: "commercial" });
    expect(id).toBeTruthy();
    await upsertBaselineCoverage(svc, { payerMasterId: id, cptCode: "90834", covered: true, requiresPriorAuth: false });
    const rows = await asAdmin(async (q) =>
      (await q(`select org_id, source, cpt_code from public.payer_code_coverage where payer_master_id=$1`, [id])).rows);
    expect(rows[0]).toMatchObject({ org_id: null, source: "coverlog_baseline", cpt_code: "90834" });
  });

  it("re-curating the same code UPDATES the baseline row (NULLS NOT DISTINCT dedup), not duplicates it", async () => {
    const { id } = await upsertMasterPayer(svc, { name: "Humana" });
    await upsertBaselineCoverage(svc, { payerMasterId: id, cptCode: "90837", covered: true });
    await upsertBaselineCoverage(svc, { payerMasterId: id, cptCode: "90837", covered: false }); // re-curate
    const rows = await asAdmin(async (q) =>
      (await q(`select covered from public.payer_code_coverage where payer_master_id=$1 and cpt_code='90837'`, [id])).rows);
    expect(rows).toHaveLength(1);          // updated in place, not duplicated
    expect(rows[0].covered).toBe(false);   // reflects the second curation
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- tests/db/curation.test.ts`
Expected: FAIL — `@/lib/payers/curation` not found.

- [ ] **Step 4: Write the implementation**

Create `src/lib/payers/curation.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type BaselineCoverageInput = {
  payerMasterId: string; cptCode: string; covered: boolean;
  requiresPriorAuth?: boolean; modifierRequired?: string;
  telehealthAllowed?: boolean; unitLimit?: string; notes?: string; verifiedBy?: string;
};
export type BaselineClaimRuleInput = {
  payerMasterId: string; ruleCategory: string; fieldReference?: string;
  ruleDescription?: string; requiredValue?: string; notes?: string; verifiedBy?: string;
};

export async function upsertMasterPayer(
  svc: Pick<SupabaseClient, "from">, input: { name: string; payerType?: string },
): Promise<{ id: string }> {
  const { data, error } = await svc.from("payer_master")
    .upsert({ name: input.name, payer_type: input.payerType ?? null }, { onConflict: "name" })
    .select("id").single();
  if (error) throw new Error(`upsertMasterPayer failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

export async function upsertBaselineCoverage(
  svc: Pick<SupabaseClient, "from">, input: BaselineCoverageInput,
): Promise<void> {
  const { error } = await svc.from("payer_code_coverage").upsert({
    org_id: null, payer_master_id: input.payerMasterId, cpt_code: input.cptCode,
    covered: input.covered, requires_prior_auth: input.requiresPriorAuth ?? false,
    modifier_required: input.modifierRequired ?? null, telehealth_allowed: input.telehealthAllowed ?? null,
    unit_limit: input.unitLimit ?? null, notes: input.notes ?? null,
    source: "coverlog_baseline", verified_at: new Date().toISOString(), verified_by: input.verifiedBy ?? null,
  }, { onConflict: "payer_master_id,cpt_code,org_id" });
  if (error) throw new Error(`upsertBaselineCoverage failed: ${error.message}`);
}

export async function upsertBaselineClaimRule(
  svc: Pick<SupabaseClient, "from">, input: BaselineClaimRuleInput,
): Promise<void> {
  const { error } = await svc.from("payer_claim_rules").upsert({
    org_id: null, payer_master_id: input.payerMasterId, rule_category: input.ruleCategory,
    field_reference: input.fieldReference ?? null, rule_description: input.ruleDescription ?? null,
    required_value: input.requiredValue ?? null, notes: input.notes ?? null,
    source: "coverlog_baseline", verified_at: new Date().toISOString(), verified_by: input.verifiedBy ?? null,
  }, { onConflict: "payer_master_id,rule_category,field_reference,org_id" });
  if (error) throw new Error(`upsertBaselineClaimRule failed: ${error.message}`);
}
```

- [ ] **Step 5: Add baseline unique indexes for the curation upserts**

The baseline upserts conflict-target `(payer_master_id, cpt_code, org_id)` and `(payer_master_id, rule_category, field_reference, org_id)`. The Task 3 `NULLS NOT DISTINCT` indexes cover exactly these column *sets* (Postgres matches `ON CONFLICT` by set, order-independent), and `NULLS NOT DISTINCT` is what lets the `org_id IS NULL` baseline rows conflict-and-update instead of duplicating. **No new index needed** — the Task 3 `0011` indexes serve both. Confirm by running the curation test (Step 6): re-running `upsertBaselineCoverage` for the same `(payer_master_id, cpt_code)` must UPDATE the single baseline row, not insert a duplicate (the test asserts exactly one row).

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- tests/db/curation.test.ts`
Expected: 1 passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase/service.ts src/lib/payers/curation.ts tests/db/curation.test.ts
git commit -m "feat: internal curation surface (service-role baseline writers)"
```

---

## Task 5: Payers list + tabbed Payer Profile UI

**Files:**
- Create: `src/app/(app)/payers/page.tsx`, `src/app/(app)/payers/[id]/page.tsx`
- Create: `src/app/(app)/payers/[id]/_components/{CoveredCodesTab,ClaimRulesTab,OrgOverrideForms}.tsx`
- Create: `src/app/(app)/payers/actions.ts`
- Modify: `src/app/(app)/layout.tsx` (add Payers nav link)
- Test: `tests/lib/payers-actions-smoke.test.ts`

**Interfaces:**
- Consumes Tasks 1–3 libs + foundation. Produces the tenant-facing Payer Profile (Portal Access · Covered Codes · Claim Rules tabs, provenance badges, admin override forms). No new exported lib API.

- [ ] **Step 1: Write the server actions**

Create `src/app/(app)/payers/actions.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { upsertOrgCoverage, upsertOrgClaimRule } from "@/lib/payers/mutations";

async function ctxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return { supabase, ctx };
}

export async function saveOrgCoverageAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await upsertOrgCoverage(supabase, ctx, {
    payerMasterId: String(formData.get("payerMasterId")),
    cptCode: String(formData.get("cptCode") ?? "").trim(),
    covered: formData.get("covered") === "on",
    requiresPriorAuth: formData.get("requiresPriorAuth") === "on",
    modifierRequired: String(formData.get("modifierRequired") ?? "").trim() || undefined,
  });
  revalidatePath(`/payers/${formData.get("payerDirectoryId")}`);
}

export async function saveOrgClaimRuleAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await upsertOrgClaimRule(supabase, ctx, {
    payerMasterId: String(formData.get("payerMasterId")),
    ruleCategory: String(formData.get("ruleCategory") ?? "").trim(),
    fieldReference: String(formData.get("fieldReference") ?? "").trim() || undefined,
    ruleDescription: String(formData.get("ruleDescription") ?? "").trim() || undefined,
    requiredValue: String(formData.get("requiredValue") ?? "").trim() || undefined,
  });
  revalidatePath(`/payers/${formData.get("payerDirectoryId")}`);
}
```

- [ ] **Step 2: Write the payers list page**

Create `src/app/(app)/payers/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";

export default async function PayersPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const { data: payers } = await supabase
    .from("payer_directory")
    .select("id, payer_name, portal_url, payer_master_id")
    .order("payer_name");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payers</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Payer</th><th>Portal</th><th>Linked</th></tr></thead>
        <tbody>
          {(payers ?? []).map((p: any) => (
            <tr key={p.id} className="border-b">
              <td className="p-2"><Link href={`/payers/${p.id}`} className="underline">{p.payer_name}</Link></td>
              <td>{p.portal_url ? <a href={p.portal_url} target="_blank" rel="noreferrer" className="underline">Open portal</a> : "—"}</td>
              <td>{p.payer_master_id ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Write the tabbed Payer Profile page**

Create `src/app/(app)/payers/[id]/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { resolveCoverage, resolveClaimRules } from "@/lib/payers/resolve";
import { CoveredCodesTab } from "./_components/CoveredCodesTab";
import { ClaimRulesTab } from "./_components/ClaimRulesTab";

export default async function PayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const { data: payer } = await supabase
    .from("payer_directory")
    .select("id, payer_name, portal_url, login_notes, username_hint, payer_master_id")
    .eq("id", id).maybeSingle();
  if (!payer) notFound();

  const masterId = (payer as any).payer_master_id as string | null;
  const [coverage, rules] = masterId
    ? await Promise.all([resolveCoverage(supabase, masterId), resolveClaimRules(supabase, masterId)])
    : [[], []];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{(payer as any).payer_name}</h1>
      <section>
        <h2 className="font-medium">Portal Access</h2>
        <p className="text-sm">{(payer as any).portal_url
          ? <a href={(payer as any).portal_url} target="_blank" rel="noreferrer" className="underline">Open portal</a>
          : "No portal URL"}</p>
        {(payer as any).login_notes && <p className="text-sm text-gray-600">{(payer as any).login_notes}</p>}
      </section>
      {!masterId && <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">Link this payer to a canonical payer to see Coverlog's baseline coverage & claim rules.</p>}
      <CoveredCodesTab rows={coverage} payerMasterId={masterId} payerDirectoryId={id} />
      <ClaimRulesTab rows={rules} payerMasterId={masterId} payerDirectoryId={id} />
    </div>
  );
}
```

- [ ] **Step 4: Write the tab components (with provenance badges + override forms)**

Create `src/app/(app)/payers/[id]/_components/CoveredCodesTab.tsx`:
```tsx
import type { ResolvedCoverage } from "@/lib/payers/resolve";
import { saveOrgCoverageAction } from "../../actions";

export function CoveredCodesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedCoverage[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <section>
      <h2 className="font-medium">Covered Codes</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">CPT</th><th>Covered</th><th>Prior auth</th><th>Modifier</th><th>Source</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cpt_code} className="border-b">
              <td className="p-2">{r.cpt_code}</td><td>{r.covered ? "Yes" : "No"}</td>
              <td>{r.requires_prior_auth ? "Yes" : "No"}</td><td>{r.modifier_required ?? "—"}</td>
              <td><span className={r.provenance === "org" ? "text-blue-700" : "text-gray-500"}>
                {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgCoverageAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="cptCode" required placeholder="CPT" className="border p-1 w-24" />
          <label className="text-sm"><input type="checkbox" name="covered" defaultChecked /> covered</label>
          <label className="text-sm"><input type="checkbox" name="requiresPriorAuth" /> prior auth</label>
          <input name="modifierRequired" placeholder="Modifier" className="border p-1 w-24" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Save override</button>
        </form>
      )}
    </section>
  );
}
```

Create `src/app/(app)/payers/[id]/_components/ClaimRulesTab.tsx`:
```tsx
import type { ResolvedClaimRule } from "@/lib/payers/resolve";
import { saveOrgClaimRuleAction } from "../../actions";

export function ClaimRulesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedClaimRule[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <section>
      <h2 className="font-medium">Claim Rules</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Category</th><th>Field</th><th>Rule</th><th>Required</th><th>Source</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b">
              <td className="p-2">{r.rule_category ?? "—"}</td><td>{r.field_reference ?? "—"}</td>
              <td>{r.rule_description ?? "—"}</td><td>{r.required_value ?? "—"}</td>
              <td><span className={r.provenance === "org" ? "text-blue-700" : "text-gray-500"}>
                {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgClaimRuleAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="ruleCategory" required placeholder="Category (e.g. modifier)" className="border p-1" />
          <input name="fieldReference" placeholder="Box 24J" className="border p-1 w-24" />
          <input name="ruleDescription" placeholder="Rule" className="border p-1" />
          <input name="requiredValue" placeholder="Required value" className="border p-1" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Save override</button>
        </form>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Add the Payers nav link**

In `src/app/(app)/layout.tsx`, add a link inside the `<nav>` after the Patients link:
```tsx
        <Link href="/payers">Payers</Link>
```

- [ ] **Step 6: Smoke test the actions module**

Create `tests/lib/payers-actions-smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("payers actions module", () => {
  it("exports the two override server actions", async () => {
    const mod = await import("@/app/(app)/payers/actions");
    for (const fn of ["saveOrgCoverageAction", "saveOrgClaimRuleAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
```

- [ ] **Step 7: Run smoke + typecheck + build + full suite**

Run:
```bash
npm test -- tests/lib/payers-actions-smoke.test.ts
npx tsc --noEmit
npm run build
npm test
```
Expected: smoke passes; `tsc` clean; `next build` completes; full suite green.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/payers" "src/app/(app)/layout.tsx" tests/lib/payers-actions-smoke.test.ts
git commit -m "feat: payers list + tabbed Payer Profile (covered codes, claim rules, overrides)"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §8.2 Payer Code Coverage (Tasks 1–3, 5 — hybrid lookup, filterable by payer, provenance), §8.3 CMS-1500 Claim Rules (Tasks 1–3, 5 — checklist per payer), §8.4 Payer Profile tabbed view (Task 5: Portal Access · Covered Codes · Claim Rules), the canonical `payer_master` decision (Task 1), the internal curation surface (Task 4, service-role, off tenant path). Hybrid precedence + provenance labels (Task 2).
- **Deferred (stated up front, by design):** §8.1 Provider Credentialing (providers/payer_enrollments UI + the "Enrolled Providers" tab + license/revalidation dashboard cards) → **Plan 3b**; consent-capture admin UI → **Plan 3c**; patient-chart `primary_payer`→coverage cross-reference → wired in 3b/3c once the patient detail page gains a payer link. Office Ally + crowd-sourcing remain out (Plan 4 / never).
- **Migration numbering:** continues `0010`, `0011`. Both repoint/extend existing `0003` tables; `db:reset` rebuilds cleanly in order.
- **Type consistency:** `ResolvedCoverage`/`ResolvedClaimRule` (Task 2) consumed by Task 5 tabs; `OrgCoverageInput`/`OrgClaimRuleInput` (Task 3) consumed by actions; `StaffContext` from foundation. `payer_master_id` used consistently after Task 1's rename (no remaining `payer_id` references in new code).
- **Curation isolation:** `createServiceSupabase()` (Task 4) carries an explicit "never import from tenant-facing code" comment; it lives under `src/lib/supabase/service.ts` and is used only by curation lib / `src/app/internal/**`. A whole-branch review should grep that no tenant page/action imports it.

---

## Subsequent Plans
- **Plan 3b — Provider Credentialing:** providers + payer_enrollments UI, "Enrolled Providers" tab on the Payer Profile, license-expiring / revalidation-due dashboard cards, patient `primary_payer` → coverage cross-reference on the chart.
- **Plan 3c — Consent-capture admin UI:** `/admin` consent management (create/revoke `patient_consents`), staff & role management.
- **Plan 4 — Email Alerts + ops:** Vercel cron + AWS SES PHI-minimized digests; rolling `ensure_access_log_partition` cron (release gate before 2028-12).
