# Coverlog Curation Surface (S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin-gated UI to curate the master payer list and each payer's baseline coverage + claim rules, over the existing `src/lib/payers/curation.ts`.

**Architecture:** Add read functions to `curation.ts`; build `/internal/curation` (index: list + add payer) and `/internal/curation/[payerId]` (detail: baseline coverage + claim rules, each with an add/update form). Server actions re-verify `getPlatformContext` then write via `createServiceSupabase()` + the existing `curation.ts` upserts (which update in place on their unique keys). No migration.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + Auth), TypeScript strict, Vitest (hosted-Supabase harness), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-26-coverlog-curation-surface-design.md`

## Global Constraints

- This is **S3 of three** (S1 ✅, S2 ✅ merged). Build **only S3**. No schema migration, no RLS change, no change to `curation.ts`'s existing write functions, no tenant code.
- All curated rows are Coverlog **baselines** (`org_id = NULL`, `source = 'coverlog_baseline'`) — written only through `curation.ts`. No delete, no per-row inline-edit widget, no org-override editing (YAGNI). Add doubles as edit via the idempotent upsert (unique keys `(org_id, payer_master_id, cpt_code)` and `(org_id, payer_master_id, rule_category, field_reference)`, `NULLS NOT DISTINCT`).
- `createServiceSupabase()` may be imported ONLY by `/internal/curation` page, the `[payerId]` detail page, and `/internal/curation/actions.ts` — each behind a `getPlatformContext` check. Never from tenant code; `curation.ts` itself takes a passed-in client.
- Every action re-verifies `getPlatformContext(await createServerSupabase())` and `redirect("/sign-in")` if not a superadmin BEFORE any service-role use; sets `verifiedBy = platform.email`; required-field blanks → early `return`; then `revalidatePath`.
- `curation.ts` convention: functions take `Pick<SupabaseClient,"from">` and `throw new Error("<fn> failed: " + error.message)` on a Supabase error.
- All `/internal` pages set `export const dynamic = "force-dynamic"`. Next 16 dynamic params are a Promise.
- TypeScript strict; `@/*` → `./src/*`. Tests via `npm test` (vitest serial); no migration so no `db:reset` needed (tables already exist). Commits end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Read functions in `curation.ts` + tests

**Files:**
- Modify: `src/lib/payers/curation.ts` (append read functions + row types)
- Test: `tests/db/curation-queries.test.ts`

**Interfaces:**
- Consumes: existing `upsertMasterPayer`, `upsertBaselineCoverage`, `upsertBaselineClaimRule` from `curation.ts`; `tests/db/helpers.ts` (`asAdmin`, `pool`, `resetDb`); `createServiceSupabase`.
- Produces: `MasterPayer = { id: string; name: string; payer_type: string | null }`; `BaselineCoverageRow = { id, cpt_code, covered, requires_prior_auth, telehealth_allowed: boolean|null, modifier_required: string|null, unit_limit: string|null, notes: string|null, verified_by: string|null }`; `BaselineClaimRuleRow = { id, rule_category: string|null, field_reference: string|null, rule_description: string|null, required_value: string|null, notes: string|null, verified_by: string|null }`; `listMasterPayers(svc)`, `listBaselineCoverage(svc, payerMasterId)`, `listBaselineClaimRules(svc, payerMasterId)` — consumed by Tasks 2 & 3.

- [ ] **Step 1: Append the read functions to `curation.ts`**

Append to the end of `src/lib/payers/curation.ts`:

```ts
export type MasterPayer = { id: string; name: string; payer_type: string | null };
export type BaselineCoverageRow = {
  id: string; cpt_code: string; covered: boolean; requires_prior_auth: boolean;
  telehealth_allowed: boolean | null; modifier_required: string | null;
  unit_limit: string | null; notes: string | null; verified_by: string | null;
};
export type BaselineClaimRuleRow = {
  id: string; rule_category: string | null; field_reference: string | null;
  rule_description: string | null; required_value: string | null; notes: string | null;
  verified_by: string | null;
};

export async function listMasterPayers(svc: Pick<SupabaseClient, "from">): Promise<MasterPayer[]> {
  const { data, error } = await svc.from("payer_master")
    .select("id, name, payer_type").order("name");
  if (error) throw new Error(`listMasterPayers failed: ${error.message}`);
  return (data ?? []) as MasterPayer[];
}

export async function listBaselineCoverage(
  svc: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<BaselineCoverageRow[]> {
  const { data, error } = await svc.from("payer_code_coverage")
    .select("id, cpt_code, covered, requires_prior_auth, telehealth_allowed, modifier_required, unit_limit, notes, verified_by")
    .eq("payer_master_id", payerMasterId).is("org_id", null).order("cpt_code");
  if (error) throw new Error(`listBaselineCoverage failed: ${error.message}`);
  return (data ?? []) as BaselineCoverageRow[];
}

export async function listBaselineClaimRules(
  svc: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<BaselineClaimRuleRow[]> {
  const { data, error } = await svc.from("payer_claim_rules")
    .select("id, rule_category, field_reference, rule_description, required_value, notes, verified_by")
    .eq("payer_master_id", payerMasterId).is("org_id", null).order("rule_category");
  if (error) throw new Error(`listBaselineClaimRules failed: ${error.message}`);
  return (data ?? []) as BaselineClaimRuleRow[];
}
```

- [ ] **Step 2: Write the test**

Create `tests/db/curation-queries.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { asAdmin, pool, resetDb } from "./helpers";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  upsertMasterPayer, upsertBaselineCoverage, upsertBaselineClaimRule,
  listMasterPayers, listBaselineCoverage, listBaselineClaimRules,
} from "@/lib/payers/curation";

const svc = createServiceSupabase();
const ORG = "33333333-3333-3333-3333-333333333333";
let aetnaId: string;

beforeAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_claim_rules, public.payer_master, public.organizations restart identity cascade`));
  await asAdmin((q) => q(`insert into public.organizations (id, name) values ($1,'Override Org')`, [ORG]));
  await upsertMasterPayer(svc, { name: "Cigna" });
  aetnaId = (await upsertMasterPayer(svc, { name: "Aetna", payerType: "commercial" })).id;
  await upsertBaselineCoverage(svc, { payerMasterId: aetnaId, cptCode: "90834", covered: true });
  await upsertBaselineCoverage(svc, { payerMasterId: aetnaId, cptCode: "90837", covered: false, requiresPriorAuth: true });
  await upsertBaselineClaimRule(svc, { payerMasterId: aetnaId, ruleCategory: "timely_filing", requiredValue: "90 days" });
  // org-scoped OVERRIDE for the same payer+CPT — must be excluded from baseline lists
  await asAdmin((q) => q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, source) values ($1,$2,'90834','org')`, [ORG, aetnaId]));
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_claim_rules, public.payer_master, public.organizations restart identity cascade`));
  await resetDb(); await pool.end();
});

describe("curation queries (service role)", () => {
  it("listMasterPayers returns all payers ordered by name", async () => {
    const names = (await listMasterPayers(svc)).map((p) => p.name);
    expect(names).toEqual(["Aetna", "Cigna"]);
  });

  it("listBaselineCoverage returns only baseline (org_id null) rows, excluding org overrides", async () => {
    const rows = await listBaselineCoverage(svc, aetnaId);
    expect(rows.map((r) => r.cpt_code)).toEqual(["90834", "90837"]); // ordered; the org override of 90834 is excluded
    expect(rows).toHaveLength(2);
    const r37 = rows.find((r) => r.cpt_code === "90837")!;
    expect(r37.covered).toBe(false);
    expect(r37.requires_prior_auth).toBe(true);
  });

  it("listBaselineClaimRules returns the baseline rules", async () => {
    const rules = await listBaselineClaimRules(svc, aetnaId);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ rule_category: "timely_filing", required_value: "90 days" });
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- curation-queries`
Expected: the `curation queries (service role)` block passes (3 tests).

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; full suite green (previous 147 + 3 new = 150; no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payers/curation.ts tests/db/curation-queries.test.ts
git commit -m "feat: curation read functions (master payers + baselines)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Curation index page + add-payer action + landing link

**Files:**
- Create: `src/app/internal/curation/actions.ts`
- Create: `src/app/internal/curation/page.tsx`
- Modify: `src/app/internal/page.tsx`

**Interfaces:**
- Consumes: `listMasterPayers`, `upsertMasterPayer` from `@/lib/payers/curation` (Task 1); `getPlatformContext` (`@/lib/auth/platform`); `createServerSupabase` (`@/lib/supabase/server`); `createServiceSupabase` (`@/lib/supabase/service`); `PageHeader`, `Card`; `@/lib/ui` (`tableWrap, theadRow, thCell, tbody, rowHover, inputClass, labelClass, btnPrimary`).
- Produces: `addMasterPayerAction(formData: FormData)` (Task 3 adds two more actions to this same file); the `/internal/curation` route.

- [ ] **Step 1: Write the add-master-payer action**

Create `src/app/internal/curation/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { upsertMasterPayer } from "@/lib/payers/curation";

export async function addMasterPayerAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const payerType = String(formData.get("payerType") ?? "").trim() || undefined;
  await upsertMasterPayer(createServiceSupabase(), { name, payerType });
  revalidatePath("/internal/curation");
}
```

- [ ] **Step 2: Write the index page**

Create `src/app/internal/curation/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { listMasterPayers } from "@/lib/payers/curation";
import { addMasterPayerAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { tableWrap, theadRow, thCell, tbody, rowHover, inputClass, labelClass, btnPrimary } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function CurationPage() {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const payers = await listMasterPayers(createServiceSupabase());
  return (
    <div className="space-y-4">
      <PageHeader title="Payer Curation" subtitle={`${payers.length} master payers`} backHref="/internal" />
      <Card title="Add master payer">
        <form action={addMasterPayerAction} className="p-5 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className={labelClass}>Name</label>
            <input name="name" required className={inputClass} placeholder="e.g. Aetna" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className={labelClass}>Type</label>
            <input name="payerType" className={inputClass} placeholder="commercial / medicaid …" />
          </div>
          <button className={btnPrimary}>Add payer</button>
        </form>
      </Card>
      {payers.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">No master payers yet.</div>
      ) : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Type</th></tr></thead>
            <tbody className={tbody}>
              {payers.map((p) => (
                <tr key={p.id} className={rowHover}>
                  <td className="px-4 py-4"><Link href={`/internal/curation/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-teal-600">{p.name}</Link></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.payer_type ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the landing "Payer Curation" row to a link**

In `src/app/internal/page.tsx`, the `TOOLS` array has a "Payer Curation" entry with no `href`. Add the `href` so it renders as an "Open" link. Change:

```tsx
  { name: "Payer Curation", desc: "Curate the master payer list and baseline coverage / claim rules." },
```

to:

```tsx
  { name: "Payer Curation", desc: "Curate the master payer list and baseline coverage / claim rules.", href: "/internal/curation" },
```

(Leave the rest of the file unchanged.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds; route list includes `/internal/curation` (dynamic `ƒ`).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: green (no regressions; Task 2 adds UI only).

- [ ] **Step 6: Commit**

```bash
git add src/app/internal/curation/actions.ts src/app/internal/curation/page.tsx src/app/internal/page.tsx
git commit -m "feat: /internal/curation index + add master payer + landing link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Curation detail page + baseline actions + BUILD GATE

**Files:**
- Modify: `src/app/internal/curation/actions.ts` (append two actions)
- Create: `src/app/internal/curation/[payerId]/page.tsx`

**Interfaces:**
- Consumes: `listBaselineCoverage`, `listBaselineClaimRules`, `upsertBaselineCoverage`, `upsertBaselineClaimRule` from `@/lib/payers/curation` (Task 1); `addBaselineCoverageAction`, `addBaselineClaimRuleAction` from `./actions` (this task) / `../actions` (page); `getPlatformContext`; `createServerSupabase`; `createServiceSupabase`; `PageHeader`, `Card`; `@/lib/ui` (`theadRow, thCell, tbody, rowHover, inputClass, labelClass, btnPrimary`).
- Produces: the `/internal/curation/[payerId]` route.

- [ ] **Step 1: Append the two baseline actions to `actions.ts`**

Append to `src/app/internal/curation/actions.ts` (add the imports `upsertBaselineCoverage`, `upsertBaselineClaimRule` to the existing `@/lib/payers/curation` import line, then add the two functions):

```ts
import { upsertBaselineCoverage, upsertBaselineClaimRule } from "@/lib/payers/curation";

export async function addBaselineCoverageAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const payerMasterId = String(formData.get("payerMasterId") ?? "");
  const cptCode = String(formData.get("cptCode") ?? "").trim();
  if (!payerMasterId || !cptCode) return;
  const tele = String(formData.get("telehealthAllowed") ?? "");
  await upsertBaselineCoverage(createServiceSupabase(), {
    payerMasterId, cptCode,
    covered: formData.get("covered") === "on",
    requiresPriorAuth: formData.get("requiresPriorAuth") === "on",
    telehealthAllowed: tele === "yes" ? true : tele === "no" ? false : undefined,
    modifierRequired: String(formData.get("modifierRequired") ?? "").trim() || undefined,
    unitLimit: String(formData.get("unitLimit") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    verifiedBy: platform.email,
  });
  revalidatePath(`/internal/curation/${payerMasterId}`);
}

export async function addBaselineClaimRuleAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const payerMasterId = String(formData.get("payerMasterId") ?? "");
  const ruleCategory = String(formData.get("ruleCategory") ?? "").trim();
  if (!payerMasterId || !ruleCategory) return;
  await upsertBaselineClaimRule(createServiceSupabase(), {
    payerMasterId, ruleCategory,
    fieldReference: String(formData.get("fieldReference") ?? "").trim() || undefined,
    ruleDescription: String(formData.get("ruleDescription") ?? "").trim() || undefined,
    requiredValue: String(formData.get("requiredValue") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    verifiedBy: platform.email,
  });
  revalidatePath(`/internal/curation/${payerMasterId}`);
}
```

(The `covered`/`requiresPriorAuth` checkboxes submit `"on"` when checked and are absent when unchecked → `false`. Empty optional text → `undefined` so the lib's `?? null`/`?? false` defaults apply. `telehealthAllowed` `""`→`undefined` (stored `null`).)

- [ ] **Step 2: Write the detail page**

Create `src/app/internal/curation/[payerId]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { listBaselineCoverage, listBaselineClaimRules } from "@/lib/payers/curation";
import { addBaselineCoverageAction, addBaselineClaimRuleAction } from "../actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { theadRow, thCell, tbody, rowHover, inputClass, labelClass, btnPrimary } from "@/lib/ui";

export const dynamic = "force-dynamic";

const yn = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "—");

export default async function CurationDetailPage({ params }: { params: Promise<{ payerId: string }> }) {
  const { payerId } = await params;
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const svc = createServiceSupabase();
  const { data: payer } = await svc.from("payer_master").select("name").eq("id", payerId).maybeSingle();
  if (!payer) notFound();
  const coverage = await listBaselineCoverage(svc, payerId);
  const rules = await listBaselineClaimRules(svc, payerId);
  return (
    <div className="space-y-4">
      <PageHeader title={(payer as { name: string }).name} subtitle="Baseline curation" backHref="/internal/curation" />

      <Card title="Baseline coverage">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className={theadRow}>
              <th className={thCell}>CPT</th><th className={thCell}>Covered</th><th className={thCell}>Prior auth</th>
              <th className={thCell}>Telehealth</th><th className={thCell}>Modifier</th><th className={thCell}>Unit limit</th><th className={thCell}>Notes</th>
            </tr></thead>
            <tbody className={tbody}>
              {coverage.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No baseline coverage yet.</td></tr>
              ) : coverage.map((r) => (
                <tr key={r.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{r.cpt_code}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{yn(r.covered)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{yn(r.requires_prior_auth)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{yn(r.telehealth_allowed)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.modifier_required ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.unit_limit ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={addBaselineCoverageAction} className="p-5 border-t border-slate-100 flex flex-wrap items-end gap-3">
          <input type="hidden" name="payerMasterId" value={payerId} />
          <div className="w-28"><label className={labelClass}>CPT</label><input name="cptCode" required className={inputClass} placeholder="90834" /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5"><input type="checkbox" name="covered" defaultChecked /> Covered</label>
          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5"><input type="checkbox" name="requiresPriorAuth" /> Prior auth</label>
          <div className="w-28"><label className={labelClass}>Telehealth</label>
            <select name="telehealthAllowed" className={inputClass}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></div>
          <div className="w-28"><label className={labelClass}>Modifier</label><input name="modifierRequired" className={inputClass} placeholder="95" /></div>
          <div className="w-28"><label className={labelClass}>Unit limit</label><input name="unitLimit" className={inputClass} /></div>
          <div className="flex-1 min-w-[160px]"><label className={labelClass}>Notes</label><input name="notes" className={inputClass} /></div>
          <button className={btnPrimary}>Save coverage</button>
        </form>
      </Card>

      <Card title="Baseline claim rules">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className={theadRow}>
              <th className={thCell}>Category</th><th className={thCell}>Field</th><th className={thCell}>Required value</th><th className={thCell}>Description</th><th className={thCell}>Notes</th>
            </tr></thead>
            <tbody className={tbody}>
              {rules.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No baseline claim rules yet.</td></tr>
              ) : rules.map((r) => (
                <tr key={r.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{r.rule_category ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.field_reference ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.required_value ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.rule_description ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={addBaselineClaimRuleAction} className="p-5 border-t border-slate-100 flex flex-wrap items-end gap-3">
          <input type="hidden" name="payerMasterId" value={payerId} />
          <div className="w-40"><label className={labelClass}>Category</label><input name="ruleCategory" required className={inputClass} placeholder="timely_filing" /></div>
          <div className="w-32"><label className={labelClass}>Field</label><input name="fieldReference" className={inputClass} /></div>
          <div className="w-40"><label className={labelClass}>Required value</label><input name="requiredValue" className={inputClass} /></div>
          <div className="flex-1 min-w-[160px]"><label className={labelClass}>Description</label><input name="ruleDescription" className={inputClass} /></div>
          <div className="flex-1 min-w-[120px]"><label className={labelClass}>Notes</label><input name="notes" className={inputClass} /></div>
          <button className={btnPrimary}>Save rule</button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build (BUILD GATE)**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds; route list includes `/internal/curation/[payerId]` (dynamic `ƒ`).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: green (no regressions; Task 3 adds UI + actions only, no new DB behavior beyond Task 1's tested reads/the existing upserts).

- [ ] **Step 5: Commit**

```bash
git add src/app/internal/curation/actions.ts "src/app/internal/curation/[payerId]/page.tsx"
git commit -m "feat: /internal/curation/[payerId] baseline coverage + claim rule curation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- After all three tasks: dispatch the whole-branch review (most capable model), then finish via `superpowers:finishing-a-development-branch` → merge to main locally + push (per the standing "Always 1" preference).
- No migration in this branch, so no `db:reset` is required; the curation tables/keys already exist (migrations `0003`/`0010`/`0011`).
