# Coverlog Curation Surface (S3) — Design

**Status:** Approved direction (2026-06-26).

## Context

Final part of the three-part internal/platform chunk (S1 superadmin foundation ✅ merged `94f9c24`; S2 org enable/disable ✅ merged `cf27a1f`):

- **S1** — superadmin foundation (`superadmins` + `getPlatformContext` + gated `/internal` shell).
- **S2** — org enable/disable (`organizations.status` + app-layer gate + `/internal/orgs`).
- **S3 — Curation surface** (this spec): a superadmin UI over the existing `src/lib/payers/curation.ts` to curate the **master payer list** and each payer's **baseline coverage** and **baseline claim rules**.

## Goal

Give internal Coverlog staff an in-app way to maintain the canonical payer knowledge that every tenant reads: add master payers, and add/update each payer's Coverlog-curated baseline coverage (per CPT) and baseline claim rules. Today these are writable only by calling `curation.ts` from code; this adds the gated UI.

## Decisions (resolved in brainstorming)

1. **Three entities, two pages.** An index (`/internal/curation`) for the master payer list + add-payer; a detail page (`/internal/curation/[payerId]`) for that payer's baseline coverage + baseline claim rules.
2. **Add doubles as edit via upsert.** `curation.ts`'s upserts are idempotent on their unique keys (`(org_id, payer_master_id, cpt_code)` and `(org_id, payer_master_id, rule_category, field_reference)`, `NULLS NOT DISTINCT`), so re-submitting an existing key updates the baseline row in place. Existing rows render read-only in a table; to change one, re-submit the form with the same key.
3. **Baselines only.** Every curated row is a Coverlog baseline (`org_id = NULL`, `source = 'coverlog_baseline'`) — written by `curation.ts`. No org-override editing, no delete, no per-row inline-edit widget (YAGNI).
4. **Gated like `/internal/orgs`.** Pages + actions re-verify `getPlatformContext`; writes go through `createServiceSupabase()` only inside the action layer (after the superadmin re-check). `verifiedBy` is set to the superadmin's email for attribution.
5. **No migration.** Tables, RLS, and the upsert keys already exist (migrations `0003`/`0010`/`0011`). S3 adds read functions + UI only.

## Foundation this builds on (already merged)

- `src/lib/payers/curation.ts` (service-role write lib; functions take `Pick<SupabaseClient,"from">`, throw on error):
  - `upsertMasterPayer(svc, { name, payerType? }): Promise<{ id }>`
  - `upsertBaselineCoverage(svc, BaselineCoverageInput): Promise<void>` — `BaselineCoverageInput = { payerMasterId, cptCode, covered, requiresPriorAuth?, modifierRequired?, telehealthAllowed?, unitLimit?, notes?, verifiedBy? }`; writes `org_id:null, source:'coverlog_baseline', verified_at: now()`.
  - `upsertBaselineClaimRule(svc, BaselineClaimRuleInput): Promise<void>` — `BaselineClaimRuleInput = { payerMasterId, ruleCategory, fieldReference?, ruleDescription?, requiredValue?, notes?, verifiedBy? }`.
- Schema: `payer_master(id, name unique, payer_type, created_at)`. `payer_code_coverage(id, org_id [NULL=baseline], payer_master_id, cpt_code, code_description, covered, requires_prior_auth, unit_limit, modifier_required, telehealth_allowed, notes, effective_date, source, verified_at, verified_by, …)`. `payer_claim_rules(id, org_id, payer_master_id, rule_category, field_reference, rule_description, required_value, notes, source, verified_at, verified_by, …)`. RLS: `coverage_read`/`rules_read` allow `org_id is null or org_id = user_org_id()`; the service role bypasses RLS for writes.
- `getPlatformContext(client)` (`src/lib/auth/platform.ts`) → `{ userId, email } | null`. `createServerSupabase()` / `createServiceSupabase()`. The S2 action `setOrgStatusAction` is the pattern to mirror (re-verify superadmin → service-role write → `revalidatePath`).
- `/internal` layout already gates all `/internal/*`. Landing (`src/app/internal/page.tsx`) renders tool rows with an optional `href`; "Payer Curation" is currently a *coming soon* row.
- UI: `PageHeader`, `Card`, `Badge`, `@/lib/ui` (`tableWrap, theadRow, thCell, tbody, rowHover`, `inputClass, labelClass, btnPrimary`).
- Test harness: `tests/db/curation.test.ts` shows the service-role + `asAdmin` pattern (truncate `payer_code_coverage, payer_master` in setup/teardown + `resetDb`).
- Next.js 16: dynamic route params are a Promise (`params: Promise<{ payerId: string }>`).

## Architecture

Read functions added to `curation.ts`, three server actions, two pages, one landing-link change. No schema change, no new RLS, service role only inside the gated actions/pages.

### Unit 1 — Read functions in `src/lib/payers/curation.ts`

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

export async function listMasterPayers(svc: Pick<SupabaseClient,"from">): Promise<MasterPayer[]>;
export async function listBaselineCoverage(svc: Pick<SupabaseClient,"from">, payerMasterId: string): Promise<BaselineCoverageRow[]>;
export async function listBaselineClaimRules(svc: Pick<SupabaseClient,"from">, payerMasterId: string): Promise<BaselineClaimRuleRow[]>;
```

- `listMasterPayers` selects `id, name, payer_type` ordered by `name`.
- `listBaselineCoverage` / `listBaselineClaimRules` select their columns where `payer_master_id = $1` **and `org_id is null`** (baselines only), ordered by `cpt_code` / `rule_category`. Each throws `new Error("<fn> failed: " + error.message)` on a Supabase error (matches the file's convention).

### Unit 2 — Actions `src/app/internal/curation/actions.ts`

All `"use server"`. Each re-verifies superadmin, then writes via the service role and revalidates. Shared guard pattern (mirrors `setOrgStatusAction`):

```ts
const supabase = await createServerSupabase();
const platform = await getPlatformContext(supabase);
if (!platform) redirect("/sign-in");
```

- `addMasterPayerAction(formData)`: `name` (required; if blank, `return`), `payerType` (optional). `await upsertMasterPayer(createServiceSupabase(), { name, payerType })`; `revalidatePath("/internal/curation")`.
- `addBaselineCoverageAction(formData)`: `payerMasterId` (required), `cptCode` (required; blank → `return`), `covered` (checkbox → boolean), `requiresPriorAuth` (checkbox → boolean), `telehealthAllowed` (select `""|"yes"|"no"` → `null|true|false`), `modifierRequired`/`unitLimit`/`notes` (optional text → `undefined` when blank). `verifiedBy = platform.email`. `await upsertBaselineCoverage(createServiceSupabase(), {...})`; `revalidatePath("/internal/curation/" + payerMasterId)`.
- `addBaselineClaimRuleAction(formData)`: `payerMasterId` (required), `ruleCategory` (required; blank → `return`), `fieldReference`/`ruleDescription`/`requiredValue`/`notes` (optional). `verifiedBy = platform.email`. `await upsertBaselineClaimRule(createServiceSupabase(), {...})`; `revalidatePath("/internal/curation/" + payerMasterId)`.

(Empty optional text fields are passed as `undefined` so the lib's `?? null`/`?? false` defaults apply.)

### Unit 3 — Index page `src/app/internal/curation/page.tsx`

`force-dynamic`; re-resolve `getPlatformContext` (→ `/sign-in` if null). `const payers = await listMasterPayers(createServiceSupabase())`. `PageHeader title="Payer Curation" backHref="/internal"`. An "Add master payer" `Card` with a `<form action={addMasterPayerAction}>` (name input + payer-type input + submit). A `Card`/table listing payers: Name (link to `/internal/curation/{id}`) · Type (`payer_type ?? "—"`). Empty → "No master payers yet.".

### Unit 4 — Detail page `src/app/internal/curation/[payerId]/page.tsx`

`force-dynamic`; `const { payerId } = await params`; re-resolve `getPlatformContext` (→ `/sign-in`). Service client: fetch the payer name (`payer_master` by id; if not found → `notFound()`), `listBaselineCoverage(svc, payerId)`, `listBaselineClaimRules(svc, payerId)`. `PageHeader title={payer.name} subtitle="Baseline curation" backHref="/internal/curation"`.

- **Baseline Coverage** `Card`: table of rows (CPT · Covered (Yes/No) · Prior auth (Yes/No) · Telehealth (Yes/No/—) · Modifier · Unit limit · Notes); below it a `<form action={addBaselineCoverageAction}>` with a hidden `payerMasterId`, inputs for `cptCode`, `covered`/`requiresPriorAuth` checkboxes, a `telehealthAllowed` select (—/Yes/No), `modifierRequired`, `unitLimit`, `notes`, and submit "Save coverage".
- **Baseline Claim Rules** `Card`: table (Category · Field · Required value · Description · Notes); below it a `<form action={addBaselineClaimRuleAction}>` with hidden `payerMasterId`, inputs for `ruleCategory`, `fieldReference`, `requiredValue`, `ruleDescription`, `notes`, submit "Save rule".

Forms are plain server-action forms (no client component needed — no confirm step here).

### Unit 5 — Landing link (modify `src/app/internal/page.tsx`)

Add `href: "/internal/curation"` to the "Payer Curation" tool entry so it renders as an "Open" link (same mechanism S2 used for Organizations).

## Data Flow

Superadmin → `/internal/curation` (gated) → `listMasterPayers` (service role) → add payer (`addMasterPayerAction` → `upsertMasterPayer`) → detail → `listBaselineCoverage`/`listBaselineClaimRules` → add/update a baseline (`addBaseline*Action` → `upsertBaseline*` with `org_id:null`, `verified_by:email`) → `revalidatePath`. Tenants later read these baselines via the existing `coverage_read`/`rules_read` RLS (`org_id is null or own`).

## Error Handling

- Actions re-verify `getPlatformContext` before any service-role use; a non-superadmin is redirected. Required-field blanks cause an early `return` (no write). The lib upserts throw on a Supabase error (surfaced to the superadmin).
- Detail page: an unknown `payerId` → `notFound()`.
- List functions throw on a Supabase error.

## Security

- `createServiceSupabase` appears only in `/internal/curation` page + detail page + `actions.ts`, each behind the `getPlatformContext` gate. No tenant code imports it; `curation.ts` itself takes a passed-in client.
- **Carried from S1/S2:** `getPlatformContext`'s env-allowlist bootstrap trusts `user.email`; curation is real cross-tenant authority over what every org reads, so for any real deployment enforce email confirmation or prefer the `superadmins` table path over the env allowlist in prod.

## Testing

`tests/db/curation-queries.test.ts` (service role + `asAdmin`, mirrors `curation.test.ts`):

- Seed via the existing upserts: `upsertMasterPayer` ("Aetna", "Cigna"); for Aetna, `upsertBaselineCoverage` two CPTs and `upsertBaselineClaimRule` one rule. Insert one **org-scoped** override coverage row directly via `asAdmin` (`org_id = <some org>`, `source='org'`) for the same payer+CPT to prove the list excludes non-baselines.
- `listMasterPayers(svc)` returns both payers ordered by name (Aetna before Cigna).
- `listBaselineCoverage(svc, aetnaId)` returns exactly the two baseline rows (`org_id null`), and **does not** include the org-scoped override row.
- `listBaselineClaimRules(svc, aetnaId)` returns the one baseline rule.
- Teardown truncates `payer_code_coverage, payer_claim_rules, payer_master` (+ `organizations` if an org was seeded) and `resetDb()`.
- **Gate:** `npx tsc --noEmit`; `npm run build` (routes `/internal/curation` and `/internal/curation/[payerId]` present); `npm test` green.

## Out of Scope

- Delete of baselines, per-row inline editing beyond re-submit, org-override editing/promotion, payer rename/merge, bulk import/CSV, crowd-sourcing.
- Audit-logging of curation writes (baselines are not PHI; could be a later enhancement).
- Any change to tenant read paths, RLS, or `curation.ts`'s existing write functions.

## File Structure

- `src/lib/payers/curation.ts` — modify (add `listMasterPayers`, `listBaselineCoverage`, `listBaselineClaimRules` + their row types).
- `src/app/internal/curation/actions.ts` — create (3 actions).
- `src/app/internal/curation/page.tsx` — create (index).
- `src/app/internal/curation/[payerId]/page.tsx` — create (detail).
- `src/app/internal/page.tsx` — modify (Payer Curation row → link).
- `tests/db/curation-queries.test.ts` — create.
