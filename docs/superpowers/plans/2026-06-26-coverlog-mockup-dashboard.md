# Coverlog Mockup Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the dashboard to the CredFlow mockup — a credentialing stat row (Total Providers · Expiring Soon · Pending Review · Flagged) + the existing eligibility stat row, plus two list panels (Pending Verifications, Expiring Credentials).

**Architecture:** Extend the existing `credentialing_stats()` SQL function (SECURITY INVOKER, session-scoped — already what the dashboard calls) with three provider-status counts; add one logged PHI read (`listPendingVerifications` in `access.ts`) and one plain provider read (`listExpiringCredentials` in `queries.ts`); rewrite the dashboard page. Everything runs as the logged-in user (RLS scopes to the org); no service role, no change to the email digest, providers page, or payer profile. This is **Plan C** of the UI initiative (A ✅ → B ✅ → C this → D nav rename).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (Postgres + RLS), Tailwind v4, Vitest, `pg`.

## Global Constraints

- **Next.js 16 App Router.** Dashboard is a server component with `export const dynamic = "force-dynamic"`. TS strict, `@/*` → `./src/*`.
- **Multi-tenancy:** all reads RLS-scoped via the request-bound client; the stats function is SECURITY INVOKER. No service role.
- **PHI-read-must-log:** `listPendingVerifications` surfaces patient name + member ID → it lives in `src/lib/phi/access.ts` and calls the existing `logAccess` (`action: "list_view"`). The dashboard becomes a PHI surface (one access_log row per load) — intended.
- **Status semantics:** Total Providers = `providers` non-deleted; Pending Review = `status='pending'`; Flagged = `status='flagged'`; Expiring Soon = licenses ≤ `current_date+60` (existing `licenses_expiring`). All counts org-scoped, anchored to DB `current_date`.
- **No change** to `org_alert_counts` (Plan 4 digest), `dashboard_stats()`, providers/payers pages. Migrations continue at `0015`; `npm run db:reset`; serial Vitest.
- Lib error convention: `throw new Error("<fn> failed: <message>")`. UI primitives: `@/components/ui/{Card,Badge}`, `@/lib/ui`.

## Foundation this plan builds on (already merged)

- `credentialing_stats()` (`0012`, SECURITY INVOKER) → `(licenses_expiring, revalidations_due)`. `dashboard_stats()` (`0009`) → `(verified_today, due_this_week, needs_attention)`. `src/lib/dashboard/stats.ts`: `getDashboardStats`/`getCredentialingStats`, `DashboardStats`/`CredentialingStats`.
- Plan B (`0014`): `providers.status` (`active`/`pending`/`flagged`, default active) + `specialty`. `providers.license_expiration date` nullable. Providers org-RLS (`0003`).
- `patients` (org-RLS): `status` (`verified`/`pending`/`inactive`), `name`, `primary_payer`, `member_id`, `next_due`, `deleted_at`.
- `src/lib/phi/access.ts`: module-private `logAccess(client, ctx, { action, patient_id?, patient_ids?, query_context? })`; `readPatient`/`listPatients`/`listCheckHistory`/`listOrgConsents` (all `client: any`, `ctx: PhiContext = {orgId, staffId}`, logged).
- `src/lib/providers/queries.ts`: `Provider` type, `listProviders(client, opts?)`. `src/app/(app)/dashboard/page.tsx` (Plan A): greeting + summary + 5 tinted cards via `getDashboardStats`+`getCredentialingStats`+staff name.
- `tests/db/credentialing-stats.test.ts` (real-auth: `createdUserId`, `userClient`, seeds ORG_A with Dr Soon (+20d) + Dr Later (+120d) + 1 enrollment).

---

## File Structure

- `supabase/migrations/0015_dashboard_stats_v2.sql` — create
- `src/lib/dashboard/stats.ts` — modify (`CredentialingStats` + `getCredentialingStats`)
- `src/lib/phi/access.ts` — add `listPendingVerifications` + `PendingVerification`
- `src/lib/providers/queries.ts` — add `listExpiringCredentials` + `ExpiringCredential`
- `src/app/(app)/dashboard/page.tsx` — rewrite
- `tests/db/credentialing-stats.test.ts` — extend; `tests/db/dashboard-panels.test.ts` — create

---

## Task 1: Extend credentialing_stats (migration + lib)

**Files:**
- Create: `supabase/migrations/0015_dashboard_stats_v2.sql`
- Modify: `src/lib/dashboard/stats.ts`
- Test: extend `tests/db/credentialing-stats.test.ts`

**Interfaces:**
- Produces (DB): `credentialing_stats()` returns `(licenses_expiring, revalidations_due, total_providers, pending_review, flagged)` (SECURITY INVOKER, RLS-scoped).
- `CredentialingStats` gains `totalProviders: number; pendingReview: number; flagged: number`; `getCredentialingStats` maps them.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0015_dashboard_stats_v2.sql`:
```sql
-- Extend credentialing_stats with provider-status counts for the dashboard.
-- SECURITY INVOKER → RLS scopes all counts to the caller's org. Superset of the
-- 0012 shape (existing two columns stay first).
create or replace function public.credentialing_stats()
  returns table (licenses_expiring bigint, revalidations_due bigint,
                 total_providers bigint, pending_review bigint, flagged bigint)
  language sql security invoker as $$
  select
    (select count(*) from public.providers
       where deleted_at is null and license_expiration is not null
         and license_expiration <= current_date + 60),
    (select count(*) from public.payer_enrollments
       where revalidation_due is not null and revalidation_due <= current_date + 60
         and status <> 'terminated'),
    (select count(*) from public.providers where deleted_at is null),
    (select count(*) from public.providers where deleted_at is null and status = 'pending'),
    (select count(*) from public.providers where deleted_at is null and status = 'flagged');
$$;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: applies cleanly through `0015`.

- [ ] **Step 3: Extend the failing test**

In `tests/db/credentialing-stats.test.ts`, replace the single `it(...)` in the `describe("getCredentialingStats", ...)` with:
```ts
  it("returns 60-day-window counts scoped to the caller's org", async () => {
    const stats = await getCredentialingStats(userClient);
    expect(stats.licensesExpiring).toBe(1);   // Dr Soon (20d), not Dr Later (120d)
    expect(stats.revalidationsDue).toBe(1);
    expect(stats.totalProviders).toBe(2);     // Dr Soon + Dr Later
    expect(stats.pendingReview).toBe(0);
    expect(stats.flagged).toBe(0);
  });

  it("counts provider status (pending/flagged) and excludes soft-deleted from totals", async () => {
    await asAdmin((q) => q(`insert into public.providers (org_id, name, status, license_expiration) values
      ($1,'Dr Pending','pending', current_date + 200),
      ($1,'Dr Flagged','flagged', current_date + 200),
      ($1,'Dr Gone','active', null)`, [ORG_A]));
    await asAdmin((q) => q(`update public.providers set deleted_at = now() where name='Dr Gone' and org_id=$1`, [ORG_A]));
    const stats = await getCredentialingStats(userClient);
    expect(stats.pendingReview).toBe(1);
    expect(stats.flagged).toBe(1);
    expect(stats.totalProviders).toBe(4);     // Dr Soon, Dr Later, Dr Pending, Dr Flagged (not Dr Gone)
    expect(stats.licensesExpiring).toBe(1);   // the +200d licenses don't count
  });
```

- [ ] **Step 4: Run to verify it fails, then add the lib fields**

Run: `npm test -- tests/db/credentialing-stats.test.ts`
Expected: FAIL — `stats.totalProviders` is `undefined` (NaN) until `getCredentialingStats` maps the new columns.

- [ ] **Step 5: Update `src/lib/dashboard/stats.ts`**

Replace the `CredentialingStats` type and `getCredentialingStats` return:
```ts
export type CredentialingStats = {
  licensesExpiring: number;
  revalidationsDue: number;
  totalProviders: number;
  pendingReview: number;
  flagged: number;
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
    totalProviders: Number(row.total_providers ?? 0),
    pendingReview: Number(row.pending_review ?? 0),
    flagged: Number(row.flagged ?? 0),
  };
}
```

- [ ] **Step 6: Run to verify it passes + typecheck**

Run:
```bash
npm test -- tests/db/credentialing-stats.test.ts
npx tsc --noEmit
```
Expected: 2 passing; `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0015_dashboard_stats_v2.sql src/lib/dashboard/stats.ts tests/db/credentialing-stats.test.ts
git commit -m "feat: credentialing_stats adds total/pending/flagged provider counts"
```

---

## Task 2: Panel reads — pending verifications (logged) + expiring credentials

**Files:**
- Modify: `src/lib/phi/access.ts`, `src/lib/providers/queries.ts`
- Test: `tests/db/dashboard-panels.test.ts`

**Interfaces:**
- Produces:
  - `listPendingVerifications(client, ctx: PhiContext): Promise<PendingVerification[]>` — pending patients (`{ id, name, primary_payer, member_id }`), logs a `list_view`.
  - `listExpiringCredentials(client): Promise<ExpiringCredential[]>` — providers with `license_expiration ≤ today+60` (`{ id, name, license_type, license_expiration }`).

- [ ] **Step 1: Write the failing test**

Create `tests/db/dashboard-panels.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listPendingVerifications } from "@/lib/phi/access";
import { listExpiringCredentials } from "@/lib/providers/queries";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userClient: ReturnType<typeof createClient>;
let userId: string;
let staffAId: string;

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({ email: "dash-panels@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.access_log, public.providers, public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    const s = await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Al','a@a.com','admin') returning id`, [ORG_A, userId]);
    staffAId = s.rows[0].id;
    // ORG_A patients: one pending (counted), one verified (not), one pending-but-deleted (not).
    await q(`insert into public.patients (org_id, name, primary_payer, member_id, status) values
      ($1,'Pat Pending','Aetna','MBI-1','pending'),
      ($1,'Pat Verified','Cigna','MBI-2','verified')`, [ORG_A]);
    await q(`insert into public.patients (org_id, name, status, deleted_at) values ($1,'Pat Gone','pending', now())`, [ORG_A]);
    // ORG_B pending patient (must NOT leak to ORG_A).
    await q(`insert into public.patients (org_id, name, status) values ($1,'B Pending','pending')`, [ORG_B]);
    // ORG_A providers for expiring credentials.
    await q(`insert into public.providers (org_id, name, license_type, license_expiration) values
      ($1,'Dr Near','LCSW', current_date + 20),
      ($1,'Dr Far','LMFT', current_date + 200)`, [ORG_A]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "dash-panels@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await asAdmin((q) => q(`truncate table public.access_log, public.providers, public.patients restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("listPendingVerifications", () => {
  it("returns only this org's pending, non-deleted patients and logs a list_view", async () => {
    const rows = await listPendingVerifications(userClient, { orgId: ORG_A, staffId: staffAId });
    expect(rows.map((r) => r.name)).toEqual(["Pat Pending"]);
    expect(rows[0]).toMatchObject({ primary_payer: "Aetna", member_id: "MBI-1" });
    const logged = await asAdmin(async (q) =>
      (await q(`select action, query_context from public.access_log where org_id=$1 and action='list_view'`, [ORG_A])).rows);
    expect(logged.some((r: any) => r.query_context === "dashboard_pending")).toBe(true);
  });
});

describe("listExpiringCredentials", () => {
  it("returns providers with licenses within 60 days, excludes far-future", async () => {
    const rows = await listExpiringCredentials(userClient);
    expect(rows.map((r) => r.name)).toEqual(["Dr Near"]);
    expect(rows[0]).toMatchObject({ license_type: "LCSW" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/dashboard-panels.test.ts`
Expected: FAIL — `listPendingVerifications` / `listExpiringCredentials` not exported.

- [ ] **Step 3: Add `listPendingVerifications` to `src/lib/phi/access.ts`**

Append (after the existing exports; reuses the module-private `logAccess` + `PhiContext`):
```ts
export type PendingVerification = {
  id: string; name: string; primary_payer: string | null; member_id: string | null;
};

// Patients pending eligibility verification — surfaces PHI (name + member id),
// so it goes through the access log like every other PHI read.
export async function listPendingVerifications(
  client: any, ctx: PhiContext,
): Promise<PendingVerification[]> {
  const { data } = await client
    .from("patients").select("id, name, primary_payer, member_id")
    .eq("status", "pending").is("deleted_at", null)
    .order("next_due", { ascending: true, nullsFirst: false });
  const rows: PendingVerification[] = data ?? [];
  await logAccess(client, ctx, {
    action: "list_view",
    patient_ids: rows.map((r) => r.id),
    query_context: "dashboard_pending",
  });
  return rows;
}
```

- [ ] **Step 4: Add `listExpiringCredentials` to `src/lib/providers/queries.ts`**

Append:
```ts
export type ExpiringCredential = {
  id: string; name: string; license_type: string | null; license_expiration: string;
};

export async function listExpiringCredentials(
  client: Pick<SupabaseClient, "from">,
): Promise<ExpiringCredential[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 60);
  const { data, error } = await client.from("providers")
    .select("id, name, license_type, license_expiration")
    .is("deleted_at", null)
    .not("license_expiration", "is", null)
    .lte("license_expiration", cutoff.toISOString().slice(0, 10))
    .order("license_expiration", { ascending: true });
  if (error) throw new Error(`listExpiringCredentials failed: ${error.message}`);
  return (data ?? []) as ExpiringCredential[];
}
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run:
```bash
npm test -- tests/db/dashboard-panels.test.ts
npx tsc --noEmit
```
Expected: 2 passing; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/phi/access.ts src/lib/providers/queries.ts tests/db/dashboard-panels.test.ts
git commit -m "feat: dashboard panel reads (logged pending verifications + expiring credentials)"
```

---

## Task 3: Dashboard page rewrite + build gate

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getDashboardStats`, `getCredentialingStats` (Task 1), `listPendingVerifications` (Task 2), `listExpiringCredentials` (Task 2), `getStaffContext`, `@/components/ui/{Card,Badge}`.

- [ ] **Step 1: Rewrite the dashboard page**

Replace `src/app/(app)/dashboard/page.tsx`:
```tsx
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { getDashboardStats, getCredentialingStats } from "@/lib/dashboard/stats";
import { listPendingVerifications } from "@/lib/phi/access";
import { listExpiringCredentials } from "@/lib/providers/queries";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

function daysLabel(dateStr: string): string {
  const d = Math.ceil((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86_400_000);
  if (d < 0) return `${-d} day${-d === 1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  return `${d} day${d === 1 ? "" : "s"} left`;
}

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  const [stats, cred, me, pending, expiring] = await Promise.all([
    getDashboardStats(supabase),
    getCredentialingStats(supabase),
    ctx ? supabase.from("staff").select("name").eq("id", ctx.staffId).maybeSingle() : Promise.resolve({ data: null }),
    ctx ? listPendingVerifications(supabase, ctx) : Promise.resolve([]),
    listExpiringCredentials(supabase),
  ]);
  const name = (me.data as { name?: string } | null)?.name ?? "there";
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const credCards = [
    { label: "Total Providers", value: cred.totalProviders, tint: "bg-teal-50 border-teal-100" },
    { label: "Expiring Soon", value: cred.licensesExpiring, tint: "bg-amber-50 border-amber-100" },
    { label: "Pending Review", value: cred.pendingReview, tint: "bg-blue-50 border-blue-100" },
    { label: "Flagged", value: cred.flagged, tint: "bg-red-50 border-red-100" },
  ];
  const eligCards = [
    { label: "Verified today", value: stats.verifiedToday, tint: "bg-emerald-50 border-emerald-100" },
    { label: "Due this week", value: stats.dueThisWeek, tint: "bg-teal-50 border-teal-100" },
    { label: "Needs attention", value: stats.needsAttention, tint: "bg-amber-50 border-amber-100" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Good {part}, {name}</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {pending.length} eligibility verification{pending.length === 1 ? "" : "s"} pending · {cred.licensesExpiring} credential{cred.licensesExpiring === 1 ? "" : "s"} expiring soon
        </p>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Credentialing</div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {credCards.map((c) => (
            <div key={c.label} className={`${c.tint} border rounded-2xl p-5`}>
              <div className="text-3xl font-bold text-slate-900">{c.value}</div>
              <div className="text-sm text-slate-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Eligibility</div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {eligCards.map((c) => (
            <div key={c.label} className={`${c.tint} border rounded-2xl p-5`}>
              <div className="text-3xl font-bold text-slate-900">{c.value}</div>
              <div className="text-sm text-slate-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pending Verifications">
          {pending.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">No pending verifications.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {pending.map((p) => (
                <Link key={p.id} href={`/patients/${p.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.primary_payer ?? "—"}{p.member_id ? ` · ${p.member_id}` : ""}</div>
                  </div>
                  <Badge value="pending" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Expiring Credentials">
          {expiring.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">No credentials expiring.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {expiring.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{e.name}</div>
                    <div className="text-xs text-slate-500">{e.license_type ?? "License"}</div>
                  </div>
                  <span className="text-xs font-medium text-amber-700">{daysLabel(e.license_expiration)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build gate — typecheck + build + full suite**

Run:
```bash
npx tsc --noEmit
npm run build
npm test
```
Expected: `tsc` clean; `next build` completes with `/dashboard` present; full suite green (prior 132 + Task 1's +1 it + Task 2's +2 its = 135).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat: mockup dashboard (credentialing cards + pending/expiring panels)"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** `credentialing_stats` total/pending/flagged (Task 1); `getCredentialingStats` mapping (Task 1); logged `listPendingVerifications` + `listExpiringCredentials` (Task 2); dashboard greeting/summary + 4 credentialing cards + 3 eligibility cards + 2 panels (Task 3). PHI-read-must-log honored (Task 2 logs `list_view`; test asserts the access_log row). Decisions: name+payer+member_id panel (Task 3 row markup), both card sets (Task 3).
- **Type consistency:** `CredentialingStats.totalProviders/pendingReview/flagged` (Task 1) → dashboard credCards (Task 3); `PendingVerification`/`ExpiringCredential` (Task 2) → panels (Task 3); `listPendingVerifications(client, ctx)` takes `PhiContext` (the dashboard passes `ctx`, which is a `StaffContext` superset).
- **No regressions:** `credentialing_stats` stays a superset (existing two columns first) so `getCredentialingStats`'s prior fields keep working; `dashboard_stats`/`org_alert_counts`/providers/payers untouched. `listExpiringCredentials` is RLS-scoped, non-PHI (no log). Existing tests unaffected; the credentialing-stats test is extended for the new fields.
- **Window parity caveat:** the "Expiring Soon" card (DB `current_date+60`) and the Expiring Credentials panel (`listExpiringCredentials`, JS `today+60` date) can differ by one row only at a UTC day boundary — acceptable for a display panel.
- **Migration numbering:** `0015`; `db:reset` rebuilds cleanly.

---

## Subsequent Plans
- **D — Nav/IA rename:** Insurance Eligibility / Insurance Credentialing (its own brainstorm for the mapping).
- Optional: surface `flagged`/`pending_review` in the weekly email digest (`org_alert_counts`).
