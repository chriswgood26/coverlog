# Coverlog Audit-Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only, read-only viewer for the org's `access_log` + `disclosure_log`, with patient/actor names joined and the view itself logged as a meta `audit_view`.

**Architecture:** One new logged read (`listAuditTrail`) in the PHI access layer + one new admin page + a link from `/admin`. RLS scopes the reads to the caller's org; no service role, no schema change. The two audit tables already have org-scoped `select` RLS and are append-only.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (Postgres + RLS), Tailwind v4, Vitest, `pg`.

## Global Constraints

- **Next.js 16 App Router.** `/admin/audit` is a server component with `export const dynamic = "force-dynamic"`. TS strict, `@/*` → `./src/*`.
- **Admin-gated:** resolve `getStaffContext`; `if (!ctx) redirect("/onboarding")`; `if (ctx.role !== "admin") redirect("/dashboard")` (matches `/admin`, `/admin/staff`).
- **Multi-tenancy:** reads use the request-bound RLS client (org-scoped `select` on both audit tables). No service role.
- **PHI-read-must-log:** `listAuditTrail` surfaces patient names → it writes ONE meta `access_log` entry `action="audit_view"`, `query_context="admin_audit"` via the existing module-private `logAccess` (which throws if the audit insert fails). It lives in `src/lib/phi/access.ts`.
- **Append-only respected:** read-only over the existing logs; never UPDATE/DELETE them; no change to how they're written.
- No migration. Lib error convention: `throw new Error("<fn> failed: <message>")` (note: the log reads here tolerate empty data rather than throwing, matching the file's other readers). UI primitives: `@/components/ui/{Card,PageHeader}`.

## Foundation this plan builds on (already merged)

- `access_log` (`0004`, partitioned by `occurred_at`, forced RLS, `select using (org_id = public.user_org_id())`): `id, org_id, actor_staff_id→staff(id), action, patient_id→patients(id), patient_ids uuid[], query_context, occurred_at, detail`. Runway partitions provisioned (current month exists).
- `disclosure_log` (`0004`, append-only, org-scoped select): `id, org_id, patient_id→patients(id), actor_staff_id→staff(id), action, purpose, disclosed_to, occurred_at, detail`.
- `src/lib/phi/access.ts`: module-private `logAccess(client: any, ctx: PhiContext, { action, patient_id?, patient_ids?, query_context? })` (throws on failure); `PhiContext = { orgId, staffId }`; existing readers (`readPatient`, `listPatients`, `listOrgConsents`, `listPendingVerifications`) use `client: any`.
- `src/app/(app)/admin/page.tsx` — admin overview (`ctx.role !== "admin"` redirect) with a `PageHeader title="Admin"` whose children currently hold a single `<Link href="/admin/staff" className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm">Staff</Link>`.
- `@/components/ui/{Card,PageHeader}`, `@/lib/ui` (`theadRow, thCell, tbody, rowHover`). Test harness `tests/db/helpers.ts` (real-auth + `asAdmin`).

---

## File Structure

- `src/lib/phi/access.ts` — add `listAuditTrail` + `AccessEntry`/`DisclosureEntry`/`AuditTrail`
- `src/app/(app)/admin/audit/page.tsx` — create
- `src/app/(app)/admin/page.tsx` — add the Audit Log link
- `tests/db/audit-viewer.test.ts` — create

---

## Task 1: listAuditTrail (logged read) + test

**Files:**
- Modify: `src/lib/phi/access.ts`
- Test: `tests/db/audit-viewer.test.ts`

**Interfaces:**
- Produces: `listAuditTrail(client, ctx: PhiContext): Promise<AuditTrail>` where
  - `AuditTrail = { access: AccessEntry[]; disclosures: DisclosureEntry[] }`
  - `AccessEntry = { id: string; occurred_at: string; action: string; actor_name: string; patient_id: string | null; patient_label: string }`
  - `DisclosureEntry = { id: string; occurred_at: string; action: string; actor_name: string; patient_id: string | null; patient_name: string; purpose: string | null; disclosed_to: string | null }`
  - Writes one `access_log` `audit_view` (`query_context: "admin_audit"`) meta-entry.

- [ ] **Step 1: Write the failing test**

Create `tests/db/audit-viewer.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listAuditTrail } from "@/lib/phi/access";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userClient: ReturnType<typeof createClient>;
let userId: string; let staffAId: string; let p1: string; let p2: string;

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({ email: "audit-view@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.access_log, public.disclosure_log, public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    const s = await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Alice Admin','a@a.com','admin') returning id`, [ORG_A, userId]);
    staffAId = s.rows[0].id;
    const sb = await q(`insert into public.staff (org_id, name, email, role) values ($1,'Bob B','b@b.com','admin') returning id`, [ORG_B]);
    const pr = await q(`insert into public.patients (org_id, name) values ($1,'Pat One'),($1,'Pat Two') returning id`, [ORG_A]);
    p1 = pr.rows[0].id; p2 = pr.rows[1].id;
    const pb = await q(`insert into public.patients (org_id, name) values ($1,'B Patient') returning id`, [ORG_B]);
    // ORG_A access_log: a view_chart (P1) and a list_view ([P1,P2])
    await q(`insert into public.access_log (org_id, actor_staff_id, action, patient_id, occurred_at) values ($1,$2,'view_chart',$3, now())`, [ORG_A, staffAId, p1]);
    await q(`insert into public.access_log (org_id, actor_staff_id, action, patient_ids, occurred_at) values ($1,$2,'list_view',$3, now())`, [ORG_A, staffAId, [p1, p2]]);
    // ORG_A disclosure_log: a consent_granted (P1) with purpose/disclosed_to
    await q(`insert into public.disclosure_log (org_id, actor_staff_id, action, patient_id, purpose, disclosed_to, occurred_at) values ($1,$2,'consent_granted',$3,'billing','Aetna', now())`, [ORG_A, staffAId, p1]);
    // ORG_B access_log row (must NOT leak)
    await q(`insert into public.access_log (org_id, actor_staff_id, action, patient_id, occurred_at) values ($1,$2,'view_chart',$3, now())`, [ORG_B, sb.rows[0].id, pb.rows[0].id]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "audit-view@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await asAdmin((q) => q(`truncate table public.access_log, public.disclosure_log, public.patients restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("listAuditTrail", () => {
  it("returns the org's access + disclosure entries with joined names, newest-first, and excludes other orgs", async () => {
    const trail = await listAuditTrail(userClient, { orgId: ORG_A, staffId: staffAId });
    // access entries (the seeded two; plus possibly the audit_view we just wrote, ordered first)
    const view = trail.access.find((e) => e.action === "view_chart")!;
    expect(view.actor_name).toBe("Alice Admin");
    expect(view.patient_label).toBe("Pat One");
    expect(view.patient_id).toBe(p1);
    const list = trail.access.find((e) => e.action === "list_view")!;
    expect(list.patient_label).toBe("2 patients");
    // disclosures
    expect(trail.disclosures).toHaveLength(1);
    expect(trail.disclosures[0]).toMatchObject({ action: "consent_granted", actor_name: "Alice Admin", patient_name: "Pat One", purpose: "billing", disclosed_to: "Aetna" });
    // no cross-org leak: B Patient's view_chart not present
    expect(trail.access.every((e) => e.patient_label !== "B Patient")).toBe(true);
  });

  it("writes a meta audit_view access_log entry on view", async () => {
    await listAuditTrail(userClient, { orgId: ORG_A, staffId: staffAId });
    const rows = await asAdmin(async (q) =>
      (await q(`select query_context from public.access_log where org_id=$1 and action='audit_view'`, [ORG_A])).rows);
    expect(rows.some((r: any) => r.query_context === "admin_audit")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/audit-viewer.test.ts`
Expected: FAIL — `listAuditTrail` not exported from `@/lib/phi/access`.

- [ ] **Step 3: Add `listAuditTrail` to `src/lib/phi/access.ts`**

Append (reuses the module-private `logAccess` + `PhiContext`):
```ts
export type AccessEntry = {
  id: string; occurred_at: string; action: string; actor_name: string;
  patient_id: string | null; patient_label: string;
};
export type DisclosureEntry = {
  id: string; occurred_at: string; action: string; actor_name: string;
  patient_id: string | null; patient_name: string;
  purpose: string | null; disclosed_to: string | null;
};
export type AuditTrail = { access: AccessEntry[]; disclosures: DisclosureEntry[] };

// Org admins' read of their own audit trail. Surfaces patient names (PHI), so it
// logs ONE meta "audit_view" access_log entry. RLS scopes both reads to the org.
export async function listAuditTrail(client: any, ctx: PhiContext): Promise<AuditTrail> {
  const [accRes, discRes] = await Promise.all([
    client.from("access_log")
      .select("id, occurred_at, action, actor_staff_id, patient_id, patient_ids, query_context")
      .order("occurred_at", { ascending: false }).limit(100),
    client.from("disclosure_log")
      .select("id, occurred_at, action, actor_staff_id, patient_id, purpose, disclosed_to")
      .order("occurred_at", { ascending: false }).limit(100),
  ]);
  const accRows: any[] = accRes.data ?? [];
  const discRows: any[] = discRes.data ?? [];

  const staffIds = new Set<string>();
  const patientIds = new Set<string>();
  for (const r of accRows) {
    if (r.actor_staff_id) staffIds.add(r.actor_staff_id);
    if (r.patient_id) patientIds.add(r.patient_id);
    for (const p of r.patient_ids ?? []) patientIds.add(p);
  }
  for (const r of discRows) {
    if (r.actor_staff_id) staffIds.add(r.actor_staff_id);
    if (r.patient_id) patientIds.add(r.patient_id);
  }

  const [staffRes, patRes] = await Promise.all([
    staffIds.size
      ? client.from("staff").select("id, name").in("id", [...staffIds])
      : Promise.resolve({ data: [] }),
    patientIds.size
      ? client.from("patients").select("id, name").in("id", [...patientIds])
      : Promise.resolve({ data: [] }),
  ]);
  const staffName = new Map<string, string>((staffRes.data ?? []).map((s: any) => [s.id, s.name]));
  const patName = new Map<string, string>((patRes.data ?? []).map((p: any) => [p.id, p.name]));

  await logAccess(client, ctx, {
    action: "audit_view",
    patient_ids: [...patientIds],
    query_context: "admin_audit",
  });

  const access: AccessEntry[] = accRows.map((r) => ({
    id: r.id, occurred_at: r.occurred_at, action: r.action,
    actor_name: staffName.get(r.actor_staff_id) ?? "—",
    patient_id: r.patient_id ?? null,
    patient_label: r.patient_id
      ? (patName.get(r.patient_id) ?? "—")
      : (r.patient_ids?.length ? `${r.patient_ids.length} patients` : "—"),
  }));
  const disclosures: DisclosureEntry[] = discRows.map((r) => ({
    id: r.id, occurred_at: r.occurred_at, action: r.action,
    actor_name: staffName.get(r.actor_staff_id) ?? "—",
    patient_id: r.patient_id ?? null,
    patient_name: r.patient_id ? (patName.get(r.patient_id) ?? "—") : "—",
    purpose: r.purpose ?? null, disclosed_to: r.disclosed_to ?? null,
  }));
  return { access, disclosures };
}
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run:
```bash
npm test -- tests/db/audit-viewer.test.ts
npx tsc --noEmit
```
Expected: 2 passing; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/phi/access.ts tests/db/audit-viewer.test.ts
git commit -m "feat: listAuditTrail — logged read of access + disclosure logs"
```

---

## Task 2: /admin/audit page + /admin link + build gate

**Files:**
- Create: `src/app/(app)/admin/audit/page.tsx`
- Modify: `src/app/(app)/admin/page.tsx`

**Interfaces:**
- Consumes: `listAuditTrail` (Task 1), `getStaffContext`, `@/components/ui/{Card,PageHeader}`, `@/lib/ui`.

- [ ] **Step 1: Create the audit page**

Create `src/app/(app)/admin/audit/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listAuditTrail } from "@/lib/phi/access";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { theadRow, thCell, tbody, rowHover } from "@/lib/ui";

function fmt(ts: string): string {
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function AuditLogPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const trail = await listAuditTrail(supabase, ctx);

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" subtitle="Most recent events" backHref="/admin" />

      <Card title="Access Log">
        {trail.access.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No access events.</div>
        ) : (
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>When</th><th className={thCell}>Actor</th><th className={thCell}>Action</th><th className={thCell}>Patient(s)</th></tr></thead>
            <tbody className={tbody}>
              {trail.access.map((e) => (
                <tr key={e.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmt(e.occurred_at)}</td>
                  <td className="px-4 py-3 text-sm text-slate-900">{e.actor_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.action.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-sm">
                    {e.patient_id
                      ? <Link href={`/patients/${e.patient_id}`} className="text-teal-600 hover:text-teal-700 font-medium">{e.patient_label}</Link>
                      : <span className="text-slate-600">{e.patient_label}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Disclosure Log">
        {trail.disclosures.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No disclosures.</div>
        ) : (
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>When</th><th className={thCell}>Actor</th><th className={thCell}>Action</th><th className={thCell}>Patient</th><th className={thCell}>Purpose</th><th className={thCell}>Disclosed to</th></tr></thead>
            <tbody className={tbody}>
              {trail.disclosures.map((e) => (
                <tr key={e.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmt(e.occurred_at)}</td>
                  <td className="px-4 py-3 text-sm text-slate-900">{e.actor_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.action.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-sm">
                    {e.patient_id
                      ? <Link href={`/patients/${e.patient_id}`} className="text-teal-600 hover:text-teal-700 font-medium">{e.patient_name}</Link>
                      : <span className="text-slate-600">{e.patient_name}</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.purpose ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.disclosed_to ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add the Audit Log link to the admin overview**

In `src/app/(app)/admin/page.tsx`, add a second link inside the `PageHeader` children, after the existing Staff link:
```tsx
        <Link href="/admin/audit" className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm">Audit Log</Link>
```
(Keep the existing `<Link href="/admin/staff" …>Staff</Link>` line; `Link` is already imported.)

- [ ] **Step 3: Build gate — typecheck + build + full suite**

Run:
```bash
npx tsc --noEmit
npm run build
npm test
```
Expected: `tsc` clean; `next build` completes with `/admin/audit` present; full suite green (prior 135 + Task 1's 2 = 137).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/audit/page.tsx" "src/app/(app)/admin/page.tsx"
git commit -m "feat: /admin/audit log viewer (access + disclosure) + admin link"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** `listAuditTrail` logged read of both logs with joined names + meta `audit_view` (Task 1); `/admin/audit` admin-gated page with the two sections + chart links + `/admin` link (Task 2). Decisions: both logs ✅, patient names + meta-log ✅, recent/no-filters ✅, admin-gated/no-migration/no-service-role ✅.
- **Type consistency:** `AuditTrail`/`AccessEntry`/`DisclosureEntry` (Task 1) consumed by the page (Task 2); `patient_id` drives the chart `<Link>`; `patient_label`/`patient_name` carry the joined name or "N patients"/"—".
- **Security/PHI:** RLS-scoped reads (org-only; cross-org isolation asserted in the test); meta `audit_view` written via `logAccess` (throws on failure); admin gate redirects non-admins; append-only logs are only ever read, never mutated; no service role.
- **No migration / no regression:** read-only over existing `0004` tables; existing suite unaffected; the new meta `audit_view` action is just another `access_log` insert (no schema/enum to extend — `action` is free text).

---

## Subsequent / deferred
- Audit filters (date/patient/actor/action), pagination, CSV export.
- Curation surface + org enable/disable / superadmin (separately deferred).
