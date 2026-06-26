# Coverlog Provider Status + Specialty + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider `status` (active/pending/flagged) + `specialty` to the schema and surface them on the Providers page (status pill, Specialty column, per-row admin status change, and a name/NPI/specialty search bar).

**Architecture:** One small migration (`0014`) + additive lib changes (`Provider` type, `ProviderInput`, `listProviders` search) + a Providers-page pass. RLS-scoped throughout; `org_id` from `ctx`; status mutations admin-gated at the action layer (matches existing provider mutations). No change to enrollments, the payer profile, or the dashboard. This is **Plan B** of the UI initiative (A restyle ✅ → B this → C dashboard → D nav rename).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (Postgres + RLS), Tailwind v4, Vitest, `pg`.

## Global Constraints

- **Next.js 16 App Router.** Server components by default; `export const dynamic = "force-dynamic"` on the providers page; page `searchParams` is a `Promise`. TS strict, `@/*` → `./src/*`.
- **Multi-tenancy:** RLS-scoped via the request-bound client; `org_id` from `ctx`, never client input. Status/create mutations admin-gated via the existing `adminCtxOrRedirect`.
- **Status values:** exactly `active | pending | flagged`, DB `check` constraint, default `active`. Specialty: nullable free text.
- **Search sanitization:** strip the PostgREST `or()` grammar characters `, ( ) * %` from the term and trim before building the `.or(ilike)` filter; empty-after-sanitize → no filter.
- **Migrations** continue at `0014`; apply with `npm run db:reset`; tests run serially, auto-load `.env.local`.
- **No dashboard change.** `credentialing_stats`/`org_alert_counts` are NOT touched (Plan C uses the new status field). Existing tests must stay green.
- UI primitives from Plan A: `@/lib/ui` constants, `@/components/ui/{Badge,PageHeader}`. `Badge.statusColor` already maps `active`→emerald, `pending`→amber, `flagged`→red.

## Foundation this plan builds on (already merged)

- `public.providers(id, org_id, name, npi, license_type, license_number, license_state, license_expiration, created_at, deleted_at)` — RLS `providers_isolation_all` (`for all` org-scoped). Migrations through `0013`.
- `src/lib/providers/queries.ts`: `Provider` type; `listProviders(client)` (deleted_at null, order name); `getProvider`; enrollment queries. `src/lib/providers/mutations.ts`: `ProviderInput`, `providerColumns` (omits undefined keys), `createProvider(client, ctx, input & {name})`, `updateProvider(client, ctx, id, input)` (spreads `providerColumns`), `softDeleteProvider`.
- `src/app/(app)/providers/actions.ts`: `adminCtxOrRedirect()` (redirects no-ctx → `/onboarding`, throws if non-admin), `createProviderAction`, `deleteProviderAction`.
- `src/app/(app)/providers/page.tsx` (Plan A restyle): PageHeader + `tableWrap` table, `Badge`, `btnDangerText` Remove, `isAdmin` gate, `force-dynamic`. `_components/AddProviderForm.tsx` (server component, `inputClass`/`btnPrimary`).
- Tests: `tests/db/providers.test.ts` (real-auth, two orgs A/B, `clientA`/`clientB`, `CTX_A`, `payerDirA`); `tests/lib/providers-actions-smoke.test.ts`.

---

## File Structure

- `supabase/migrations/0014_provider_status_specialty.sql` — create
- `src/lib/providers/queries.ts`, `src/lib/providers/mutations.ts` — modify
- `src/app/(app)/providers/{actions.ts,_components/AddProviderForm.tsx,page.tsx}` — modify
- `tests/db/provider-status-schema.test.ts` — create; `tests/db/providers.test.ts`, `tests/lib/providers-actions-smoke.test.ts` — extend

---

## Task 1: Migration 0014 — provider status + specialty

**Files:**
- Create: `supabase/migrations/0014_provider_status_specialty.sql`
- Test: `tests/db/provider-status-schema.test.ts`

**Interfaces:**
- Produces (DB): `public.providers.status text not null default 'active' check (status in ('active','pending','flagged'))`; `public.providers.specialty text` (nullable). RLS unchanged.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0014_provider_status_specialty.sql`:
```sql
-- Provider credentialing status + specialty (CredFlow mockup §8.1).
-- Existing rows default to 'active'. RLS (providers_isolation_all) unchanged.
alter table public.providers
  add column status text not null default 'active'
  check (status in ('active','pending','flagged'));
alter table public.providers add column specialty text;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: applies cleanly through `0014`.

- [ ] **Step 3: Write the failing test**

Create `tests/db/provider-status-schema.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, resetDb } from "./helpers";

const ORG = "11111111-1111-1111-1111-111111111111";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.providers, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG]);
  });
});
afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.providers, public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("providers.status / specialty schema", () => {
  it("defaults status to 'active' and stores specialty", async () => {
    const row = await asAdmin(async (q) =>
      (await q(`insert into public.providers (org_id, name, specialty) values ($1,'Dr A','Cardiology')
                returning status, specialty`, [ORG])).rows[0]);
    expect(row.status).toBe("active");
    expect(row.specialty).toBe("Cardiology");
  });

  it("rejects an invalid status via the check constraint", async () => {
    await expect(
      asAdmin((q) => q(`insert into public.providers (org_id, name, status) values ($1,'Dr B','bogus')`, [ORG])),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("accepts the three valid statuses", async () => {
    await asAdmin((q) => q(`insert into public.providers (org_id, name, status) values
      ($1,'Dr P','pending'),($1,'Dr F','flagged'),($1,'Dr Ac','active')`, [ORG]));
    const rows = await asAdmin(async (q) =>
      (await q(`select status from public.providers where org_id=$1 and name in ('Dr P','Dr F','Dr Ac') order by name`, [ORG])).rows);
    expect(rows.map((r: any) => r.status).sort()).toEqual(["active", "flagged", "pending"]);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/db/provider-status-schema.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0014_provider_status_specialty.sql tests/db/provider-status-schema.test.ts
git commit -m "feat: providers.status (active/pending/flagged) + specialty columns"
```

---

## Task 2: Libs — status/specialty + provider search

**Files:**
- Modify: `src/lib/providers/queries.ts`, `src/lib/providers/mutations.ts`
- Test: extend `tests/db/providers.test.ts`

**Interfaces:**
- Produces:
  - `Provider` adds `status: string; specialty: string | null`.
  - `listProviders(client, opts?: { search?: string })` — selects the new columns; when `opts.search` is non-empty (after sanitizing), filters `name`/`npi`/`specialty` via `.or(ilike)`.
  - `ProviderInput` adds `status?: "active"|"pending"|"flagged"; specialty?: string`; `providerColumns` maps them.

- [ ] **Step 1: Write the failing test (append a new describe to providers.test.ts)**

Add this import line at the top of `tests/db/providers.test.ts` alongside the existing `from "@/lib/providers/queries"` import (replace that import line):
```ts
import { listProviders, listEnrollmentsForPayer } from "@/lib/providers/queries";
```
(unchanged — it already imports `listProviders`; no edit needed if present.) Then append at the end of the file:
```ts
describe("provider status + specialty + search", () => {
  it("createProvider defaults status to active; persists status + specialty", async () => {
    const { id: d } = await createProvider(clientA, CTX_A, { name: "Dr Default" });
    const { id: f } = await createProvider(clientA, CTX_A, { name: "Dr Flag", status: "flagged", specialty: "Psychiatry" });
    const rows = await asAdmin(async (q) =>
      (await q(`select name, status, specialty from public.providers where id = any($1::uuid[]) order by name`, [[d, f]])).rows);
    expect(rows.find((r: any) => r.name === "Dr Default")).toMatchObject({ status: "active", specialty: null });
    expect(rows.find((r: any) => r.name === "Dr Flag")).toMatchObject({ status: "flagged", specialty: "Psychiatry" });
  });

  it("updateProvider flips status", async () => {
    const { id } = await createProvider(clientA, CTX_A, { name: "Dr Status" });
    await updateProvider(clientA, CTX_A, id, { status: "pending" });
    const rows = await asAdmin(async (q) =>
      (await q(`select status from public.providers where id=$1`, [id])).rows);
    expect(rows[0].status).toBe("pending");
  });

  it("listProviders search matches name, NPI, and specialty (case-insensitive)", async () => {
    await createProvider(clientA, CTX_A, { name: "Marcus Wells", npi: "5559998888", specialty: "Cardiology" });
    const byName = await listProviders(clientA, { search: "marcus" });
    expect(byName.some((r) => r.name === "Marcus Wells")).toBe(true);
    const byNpi = await listProviders(clientA, { search: "5559998888" });
    expect(byNpi.some((r) => r.name === "Marcus Wells")).toBe(true);
    const bySpec = await listProviders(clientA, { search: "cardio" });
    expect(bySpec.some((r) => r.name === "Marcus Wells")).toBe(true);
    const none = await listProviders(clientA, { search: "zzzznomatch" });
    expect(none.some((r) => r.name === "Marcus Wells")).toBe(false);
  });

  it("the Provider type exposes status + specialty", async () => {
    const rows = await listProviders(clientA);
    const m = rows.find((r) => r.name === "Marcus Wells")!;
    expect(m.status).toBe("active");
    expect(m.specialty).toBe("Cardiology");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/providers.test.ts`
Expected: FAIL — `createProvider` rejects the `status`/`specialty` keys / `listProviders` has no `search` param (type error or unfiltered results).

- [ ] **Step 3: Update `src/lib/providers/queries.ts`**

Change the `Provider` type and the three select strings + `listProviders` signature:
```ts
export type Provider = {
  id: string; name: string; npi: string | null; license_type: string | null;
  license_number: string | null; license_state: string | null;
  license_expiration: string | null; status: string; specialty: string | null;
  deleted_at: string | null;
};
```
Replace `listProviders` with:
```ts
export async function listProviders(
  client: Pick<SupabaseClient, "from">, opts: { search?: string } = {},
): Promise<Provider[]> {
  let query = client.from("providers")
    .select("id, name, npi, license_type, license_number, license_state, license_expiration, status, specialty, deleted_at")
    .is("deleted_at", null);
  const q = (opts.search ?? "").replace(/[,()*%]/g, "").trim();
  if (q) query = query.or(`name.ilike.%${q}%,npi.ilike.%${q}%,specialty.ilike.%${q}%`);
  const { data, error } = await query.order("name");
  if (error) throw new Error(`listProviders failed: ${error.message}`);
  return (data ?? []) as Provider[];
}
```
In `getProvider`, change its `.select(...)` string to include the new columns:
```ts
    .select("id, name, npi, license_type, license_number, license_state, license_expiration, status, specialty, deleted_at")
```

- [ ] **Step 4: Update `src/lib/providers/mutations.ts`**

Extend `ProviderInput` and `providerColumns`:
```ts
export type ProviderInput = {
  name?: string; npi?: string; licenseType?: string;
  licenseNumber?: string; licenseState?: string; licenseExpiration?: string;
  status?: "active" | "pending" | "flagged"; specialty?: string;
};
```
In `providerColumns`, add (after the existing `licenseExpiration` line, before `return out`):
```ts
  if (input.status !== undefined) out.status = input.status;
  if (input.specialty !== undefined) out.specialty = input.specialty;
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- tests/db/providers.test.ts`
Expected: all passing (the 6 prior + 4 new).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/providers/queries.ts src/lib/providers/mutations.ts tests/db/providers.test.ts
git commit -m "feat: provider status/specialty in libs + listProviders search"
```

---

## Task 3: Providers UI — status, specialty, search + actions

**Files:**
- Modify: `src/app/(app)/providers/actions.ts`, `src/app/(app)/providers/_components/AddProviderForm.tsx`, `src/app/(app)/providers/page.tsx`
- Test: extend `tests/lib/providers-actions-smoke.test.ts`

**Interfaces:**
- Consumes: Task 2 libs; `@/lib/ui`, `@/components/ui/{PageHeader,Badge}`.
- Produces: `setProviderStatusAction`; `createProviderAction` now reads `specialty`/`status`. No new exported lib API.

- [ ] **Step 1: Update the actions**

Replace `src/app/(app)/providers/actions.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { createProvider, softDeleteProvider, updateProvider } from "@/lib/providers/mutations";

const STATUSES = ["active", "pending", "flagged"] as const;
type Status = (typeof STATUSES)[number];
function asStatus(v: unknown): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : "active";
}

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
    specialty: String(formData.get("specialty") ?? "").trim() || undefined,
    status: asStatus(formData.get("status")),
  });
  revalidatePath("/providers");
}

export async function setProviderStatusAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await updateProvider(supabase, ctx, String(formData.get("id")), { status: asStatus(formData.get("status")) });
  revalidatePath("/providers");
}

export async function deleteProviderAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await softDeleteProvider(supabase, ctx, String(formData.get("id")));
  revalidatePath("/providers");
}
```

- [ ] **Step 2: Update `AddProviderForm`**

Replace `src/app/(app)/providers/_components/AddProviderForm.tsx`:
```tsx
import { createProviderAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function AddProviderForm() {
  return (
    <form action={createProviderAction} className="flex flex-wrap gap-2 bg-white rounded-2xl border border-slate-200 p-4">
      <input name="name" required placeholder="Provider name" className={`${inputClass} w-auto`} />
      <input name="npi" placeholder="NPI" className={`${inputClass} w-32`} />
      <input name="specialty" placeholder="Specialty" className={`${inputClass} w-40`} />
      <input name="licenseType" placeholder="License (LCSW…)" className={`${inputClass} w-36`} />
      <input name="licenseNumber" placeholder="License #" className={`${inputClass} w-28`} />
      <input name="licenseState" placeholder="State" className={`${inputClass} w-20`} />
      <input name="licenseExpiration" type="date" className={`${inputClass} w-auto`} />
      <select name="status" defaultValue="active" className={`${inputClass} w-auto`}>
        <option value="active">active</option>
        <option value="pending">pending</option>
        <option value="flagged">flagged</option>
      </select>
      <button className={btnPrimary}>Add provider</button>
    </form>
  );
}
```

- [ ] **Step 3: Update the providers page**

Replace `src/app/(app)/providers/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listProviders } from "@/lib/providers/queries";
import { AddProviderForm } from "./_components/AddProviderForm";
import { deleteProviderAction, setProviderStatusAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover, btnDangerText, inputClass, btnPrimary } from "@/lib/ui";

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const providers = await listProviders(supabase, { search: q });
  const isAdmin = ctx.role === "admin";
  return (
    <div className="space-y-4">
      <PageHeader title="Providers" subtitle={`${providers.length}${q ? " matching" : " total"}`} />
      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Search by name, NPI, or specialty…" className={inputClass} />
        <button className={btnPrimary}>Search</button>
      </form>
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}>
            <th className={thCell}>Name</th><th className={thCell}>NPI</th><th className={thCell}>Specialty</th>
            <th className={thCell}>License</th><th className={thCell}>State</th><th className={thCell}>Expires</th>
            <th className={thCell}>Status</th><th className={thCell}></th>
          </tr></thead>
          <tbody className={tbody}>
            {providers.map((p) => (
              <tr key={p.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{p.name}</td>
                <td className="px-4 py-4 text-sm text-slate-600 font-mono">{p.npi ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.specialty ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_type ?? "—"}{p.license_number ? ` ${p.license_number}` : ""}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_state ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_expiration ?? "—"}</td>
                <td className="px-4 py-4"><Badge value={p.status} /></td>
                <td className="px-4 py-4">{isAdmin && (
                  <div className="flex items-center gap-3">
                    <form action={setProviderStatusAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={p.id} />
                      <select name="status" defaultValue={p.status} className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700">
                        <option value="active">active</option>
                        <option value="pending">pending</option>
                        <option value="flagged">flagged</option>
                      </select>
                      <button className="text-teal-600 hover:text-teal-700 text-xs font-medium">Set</button>
                    </form>
                    <form action={deleteProviderAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className={btnDangerText}>Remove</button>
                    </form>
                  </div>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin && <AddProviderForm />}
    </div>
  );
}
```

- [ ] **Step 4: Extend the smoke test**

In `tests/lib/providers-actions-smoke.test.ts`, change the providers-actions assertion list to include the new action:
```ts
    for (const fn of ["createProviderAction", "deleteProviderAction", "setProviderStatusAction"]) {
```

- [ ] **Step 5: Build gate — smoke + typecheck + build + full suite**

Run:
```bash
npm test -- tests/lib/providers-actions-smoke.test.ts
npx tsc --noEmit
npm run build
npm test
```
Expected: smoke passes; `tsc` clean; `next build` completes with `/providers` present; full suite green (prior count + Task 1's 3 + Task 2's 4 new = 131).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/providers" tests/lib/providers-actions-smoke.test.ts
git commit -m "feat: providers page status pill + specialty column + search + per-row status set"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** migration status+specialty (Task 1); `Provider`/`ProviderInput`/`providerColumns` + `listProviders` search (Task 2); `createProviderAction` (specialty+status) + `setProviderStatusAction` + AddProviderForm + providers page (Specialty column, Status Badge, `?q=` search, admin per-row status set) (Task 3). Search sanitization (Task 2). Tests cover default/check/specialty (Task 1), status persist/flip + search by name/NPI/specialty (Task 2), action exports (Task 3).
- **Behavior preservation:** existing provider create/delete fields + admin gate + `force-dynamic` + license columns preserved; only additive. The dashboard (`credentialing_stats`/`org_alert_counts`) is untouched.
- **Type consistency:** `Provider.status/specialty` (Task 2) consumed by the page Badge/Specialty (Task 3); `ProviderInput.status` typed to the three values, matched by `asStatus` in actions; `listProviders(opts)` optional arg keeps the no-arg callers (payer profile's `listProviders(supabase)`) valid.
- **Deferred (Plans C/D):** dashboard Flagged/Pending-Review + Pending Verifications panel; nav rename; provider edit page.
- **Migration numbering:** `0014`; `db:reset` rebuilds cleanly.

---

## Subsequent Plans
- **C — Mockup dashboard:** Total Providers / Expiring Soon / Pending Review (status='pending') / Flagged (status='flagged') cards + Pending Verifications + Expiring Credentials panels.
- **D — Nav/IA rename:** Insurance Eligibility / Insurance Credentialing (own brainstorm for the mapping).
