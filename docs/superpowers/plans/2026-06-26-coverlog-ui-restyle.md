# Coverlog Visual Restyle (Kinship/CredFlow look) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Coverlog UI to the Kinship/CredFlow look (left sidebar + teal accent bar, white rounded-2xl cards, pill status badges, uppercase-label forms, teal buttons, dashboard greeting) — visual only, no schema or behavior changes.

**Architecture:** Add a small set of shared presentational building blocks that emit Kinship's exact Tailwind class strings (`src/lib/ui.ts` + `Badge`/`PageHeader`/`Card`), a left-sidebar shell, then do a per-page className pass composing them. No business logic, data fetches, form field names, server-action wiring, hrefs, or table columns change. This is **Plan A** of a 4-part initiative (A restyle → B provider status/specialty → C mockup dashboard → D nav rename); B/C/D are separate plans.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4 (CSS-config, no `tailwind.config`), Geist via `next/font`, Vitest. No new dependencies.

## Global Constraints

- **Visual-only / no regression.** Change ONLY Tailwind classes and presentational wrapper markup. Preserve verbatim on every page: every form field `name=`, every `<form action={…}>` server-action wiring, every hidden input, every `href`/route/`params`/`searchParams`, every conditional (`ctx.role === "admin"` gates, consent banner condition, provenance, `deleted_at`/status rendering), and every table column + the data rendered. The full test suite must stay green **unchanged** — it's the regression gate.
- **Next.js 16 App Router.** Server components by default; the Sidebar is the one new `"use client"` component. Pages keep `export const dynamic = "force-dynamic"` where present.
- **TypeScript strict.** Path alias `@/*` → `./src/*`.
- **Branding:** "Coverlog" + a teal `bg-teal-500` "C" logo mark. Not "CredFlow".
- **Exact class strings** come from `src/lib/ui.ts` (Task 1); pages import and compose them — do not hand-retype variants.
- No new deps; Tailwind v4 CSS-config unchanged.

## Kinship class vocabulary (canonical — defined once in Task 1, used everywhere)

```
btnPrimary    bg-teal-500 text-white px-4 py-2.5 rounded-xl font-semibold hover:bg-teal-400 transition-colors text-sm
btnSecondary  border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm
btnDangerText text-red-500 hover:text-red-600 text-xs font-medium
linkTeal      text-teal-600 hover:text-teal-700 font-medium
card          bg-white rounded-2xl border border-slate-200
inputClass    w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500
labelClass    text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5
tableWrap     bg-white rounded-2xl border border-slate-200 overflow-hidden
theadRow      border-b border-slate-100 bg-slate-50
thCell        text-left px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider
tbody         divide-y divide-slate-50
rowHover      hover:bg-slate-50 transition-colors
tdCell        px-4 py-4 text-sm text-slate-600
```

---

## File Structure

- `src/app/globals.css` (font), `src/app/layout.tsx` (metadata) — modify
- `src/lib/ui.ts`; `src/components/ui/{Badge,PageHeader,Card}.tsx` — create
- `src/app/(app)/_components/Sidebar.tsx` — create; `src/app/(app)/layout.tsx` — rewrite
- `src/app/(app)/dashboard/page.tsx` — greeting + tinted cards
- `src/app/(app)/patients/{page.tsx,[id]/page.tsx,_components/{AddPatientForm,CsvControls,LogCheckDrawer}.tsx}` — restyle
- `src/app/(app)/payers/{page.tsx,[id]/page.tsx,[id]/_components/{CoveredCodesTab,ClaimRulesTab,EnrolledProvidersTab}.tsx}` — restyle
- `src/app/(app)/providers/{page.tsx,_components/AddProviderForm.tsx}` — restyle
- `src/app/(app)/admin/{page.tsx,staff/page.tsx}` — restyle
- `src/app/{sign-in,sign-up,onboarding}/page.tsx` — restyle
- `tests/lib/ui-smoke.test.ts` — create

---

## Task 1: Foundation — globals, metadata, shared primitives

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/lib/ui.ts`, `src/components/ui/Badge.tsx`, `src/components/ui/PageHeader.tsx`, `src/components/ui/Card.tsx`
- Test: `tests/lib/ui-smoke.test.ts`

**Interfaces:**
- Produces:
  - `src/lib/ui.ts` exports the class-string constants listed in the vocabulary block above.
  - `statusColor(v: string): string` and `Badge({ value, label? }): JSX` from `@/components/ui/Badge`.
  - `PageHeader({ title, subtitle?, backHref?, children? })` from `@/components/ui/PageHeader`.
  - `Card({ title?, headerRight?, children, className? })` from `@/components/ui/Card`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ui-smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { statusColor } from "@/components/ui/Badge";

describe("statusColor", () => {
  it("maps known statuses to Kinship palette classes", () => {
    expect(statusColor("verified")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("enrolled")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("active")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("in_network")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("pending")).toBe("bg-amber-100 text-amber-700");
    expect(statusColor("out_of_network")).toBe("bg-amber-100 text-amber-700");
    expect(statusColor("expired")).toBe("bg-amber-100 text-amber-700");
    expect(statusColor("inactive")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("terminated")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("not_enrolled")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("revoked")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("flagged")).toBe("bg-red-100 text-red-600");
    expect(statusColor("admin")).toBe("bg-purple-100 text-purple-700");
    expect(statusColor("specialist")).toBe("bg-slate-100 text-slate-600");
  });
  it("falls back to a neutral class for unknown values", () => {
    expect(statusColor("whatever")).toBe("bg-slate-100 text-slate-600");
  });
});

describe("ui modules import", () => {
  it("ui.ts exports class constants", async () => {
    const ui = await import("@/lib/ui");
    for (const k of ["btnPrimary", "btnSecondary", "card", "inputClass", "labelClass", "tableWrap", "thCell"]) {
      expect(typeof (ui as any)[k]).toBe("string");
    }
  });
  it("Badge/PageHeader/Card modules export components", async () => {
    expect(typeof (await import("@/components/ui/Badge")).Badge).toBe("function");
    expect(typeof (await import("@/components/ui/PageHeader")).PageHeader).toBe("function");
    expect(typeof (await import("@/components/ui/Card")).Card).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/lib/ui-smoke.test.ts`
Expected: FAIL — `Cannot find module '@/components/ui/Badge'`.

- [ ] **Step 3: Create `src/lib/ui.ts`**

```ts
// Shared Tailwind class strings — the Kinship/CredFlow visual vocabulary.
// Import these instead of retyping variants so the look stays consistent.
export const btnPrimary =
  "bg-teal-500 text-white px-4 py-2.5 rounded-xl font-semibold hover:bg-teal-400 transition-colors text-sm";
export const btnSecondary =
  "border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm";
export const btnDangerText = "text-red-500 hover:text-red-600 text-xs font-medium";
export const linkTeal = "text-teal-600 hover:text-teal-700 font-medium";
export const card = "bg-white rounded-2xl border border-slate-200";
export const inputClass =
  "w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500";
export const labelClass =
  "text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5";
export const tableWrap = "bg-white rounded-2xl border border-slate-200 overflow-hidden";
export const theadRow = "border-b border-slate-100 bg-slate-50";
export const thCell =
  "text-left px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider";
export const tbody = "divide-y divide-slate-50";
export const rowHover = "hover:bg-slate-50 transition-colors";
export const tdCell = "px-4 py-4 text-sm text-slate-600";
```

- [ ] **Step 4: Create `src/components/ui/Badge.tsx`**

```tsx
const COLORS: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-700",
  enrolled: "bg-emerald-100 text-emerald-700",
  active: "bg-emerald-100 text-emerald-700",
  in_network: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  out_of_network: "bg-amber-100 text-amber-700",
  expiring: "bg-amber-100 text-amber-700",
  expired: "bg-amber-100 text-amber-700",
  inactive: "bg-slate-100 text-slate-500",
  terminated: "bg-slate-100 text-slate-500",
  not_enrolled: "bg-slate-100 text-slate-500",
  revoked: "bg-slate-100 text-slate-500",
  flagged: "bg-red-100 text-red-600",
  denied: "bg-red-100 text-red-600",
  admin: "bg-purple-100 text-purple-700",
  specialist: "bg-slate-100 text-slate-600",
};

export function statusColor(v: string): string {
  return COLORS[v] ?? "bg-slate-100 text-slate-600";
}

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${statusColor(value)}`}>
      {(label ?? value).replace(/_/g, " ")}
    </span>
  );
}
```

- [ ] **Step 5: Create `src/components/ui/PageHeader.tsx`**

```tsx
import Link from "next/link";

export function PageHeader({ title, subtitle, backHref, children }: {
  title: string; subtitle?: string; backHref?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {backHref && <Link href={backHref} className="text-slate-400 hover:text-slate-700">←</Link>}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Create `src/components/ui/Card.tsx`**

```tsx
export function Card({ title, headerRight, children, className }: {
  title?: string; headerRight?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className ?? ""}`}>
      {(title || headerRight) && (
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          {title && <h2 className="font-semibold text-slate-900">{title}</h2>}
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 7: Update `src/app/globals.css`**

Change the `body` rule's font-family (keep everything else in the file exactly as-is):
```css
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 8: Update `src/app/layout.tsx` metadata**

Replace the `metadata` object only (leave the font wiring and the rest unchanged):
```tsx
export const metadata: Metadata = {
  title: "Coverlog",
  description: "Insurance eligibility & credentialing tracker",
};
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm test -- tests/lib/ui-smoke.test.ts`
Expected: passing (2 describes).

- [ ] **Step 10: Typecheck + full suite**

Run:
```bash
npx tsc --noEmit
npm test
```
Expected: `tsc` clean; full suite green (was 120; +1 file with 2 tests → expect 122).

- [ ] **Step 11: Commit**

```bash
git add src/lib/ui.ts src/components/ui tests/lib/ui-smoke.test.ts src/app/globals.css src/app/layout.tsx
git commit -m "feat(ui): shared Kinship-style primitives + globals font + metadata"
```

---

## Task 2: App shell — Sidebar + (app) layout

**Files:**
- Create: `src/app/(app)/_components/Sidebar.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `signOutAction` from `@/app/(app)/actions` (existing, from Plan 3c); `getStaffContext` (existing).
- Produces: `Sidebar({ isAdmin })` client component.

- [ ] **Step 1: Create the Sidebar**

Create `src/app/(app)/_components/Sidebar.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "../actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/patients", label: "Patients" },
  { href: "/payers", label: "Payers" },
  { href: "/providers", label: "Providers" },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;
  const itemClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      active ? "bg-[#0d1b2e] text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;
  };
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col h-[calc(100vh-3px)] sticky top-[3px]">
      <div className="px-5 pt-4 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
          <span className="font-bold text-slate-900">Coverlog</span>
        </div>
      </div>
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={itemClass(it.href)}>{it.label}</Link>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-slate-200">
        <form action={signOutAction}>
          <button className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Rewrite `src/app/(app)/layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { Sidebar } from "./_components/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return (
    <>
      <div className="fixed top-0 left-0 right-0 h-[3px] bg-teal-500 z-50" />
      <div className="flex min-h-screen bg-slate-50 pt-[3px]">
        <Sidebar isAdmin={ctx.role === "admin"} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Typecheck + build + full suite**

Run:
```bash
npx tsc --noEmit
npm run build
npm test
```
Expected: `tsc` clean; `next build` completes (Sidebar compiles as a client component; all routes present); full suite green unchanged (122).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/_components/Sidebar.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat(ui): left-sidebar shell + teal accent bar"
```

---

## Task 3: Dashboard — greeting + tinted stat cards

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: existing `getDashboardStats`, `getCredentialingStats`; `getStaffContext` for the staff name.

- [ ] **Step 1: Rewrite the dashboard page**

Replace `src/app/(app)/dashboard/page.tsx` with (same data calls; adds greeting + tinted cards):
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { getDashboardStats, getCredentialingStats } from "@/lib/dashboard/stats";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  const [stats, cred, me] = await Promise.all([
    getDashboardStats(supabase),
    getCredentialingStats(supabase),
    ctx ? supabase.from("staff").select("name").eq("id", ctx.staffId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const name = (me.data as { name?: string } | null)?.name ?? "there";
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const cards: { label: string; value: number; tint: string }[] = [
    { label: "Verified today", value: stats.verifiedToday, tint: "bg-emerald-50 border-emerald-100" },
    { label: "Due this week", value: stats.dueThisWeek, tint: "bg-teal-50 border-teal-100" },
    { label: "Needs attention", value: stats.needsAttention, tint: "bg-amber-50 border-amber-100" },
    { label: "Licenses expiring soon", value: cred.licensesExpiring, tint: "bg-blue-50 border-blue-100" },
    { label: "Enrollments due for revalidation", value: cred.revalidationsDue, tint: "bg-red-50 border-red-100" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Good {part}, {name}</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {stats.dueThisWeek} due this week · {stats.needsAttention} need attention · {cred.licensesExpiring} licenses expiring soon
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className={`${c.tint} border rounded-2xl p-5`}>
            <div className="text-3xl font-bold text-slate-900">{c.value}</div>
            <div className="text-sm text-slate-500 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + full suite**

Run:
```bash
npx tsc --noEmit
npm test
```
Expected: `tsc` clean; full suite green unchanged (122).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(ui): dashboard greeting + tinted stat cards"
```

---

## Task 4: Patients — list, detail, and components

**Files:**
- Modify: `src/app/(app)/patients/page.tsx`, `src/app/(app)/patients/[id]/page.tsx`, `src/app/(app)/patients/_components/{AddPatientForm,CsvControls,LogCheckDrawer}.tsx`

**Interfaces:**
- Consumes: `@/lib/ui` constants; `@/components/ui/{PageHeader,Card,Badge}`. Preserves all existing actions/fields/data.

- [ ] **Step 1: Restyle `AddPatientForm`**

Replace `src/app/(app)/patients/_components/AddPatientForm.tsx`:
```tsx
"use client";
import { addPatientAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function AddPatientForm() {
  return (
    <form action={addPatientAction} className="flex flex-wrap gap-2">
      <input name="name" required placeholder="Patient name" className={`${inputClass} w-auto`} />
      <input name="memberId" placeholder="Member ID" className={`${inputClass} w-auto`} />
      <input name="primaryPayer" placeholder="Payer" className={`${inputClass} w-auto`} />
      <button type="submit" className={btnPrimary}>Add</button>
    </form>
  );
}
```

- [ ] **Step 2: Restyle `CsvControls`**

Replace `src/app/(app)/patients/_components/CsvControls.tsx` (keep the download logic + field names exactly):
```tsx
"use client";
import { importCsvAction, exportCsvAction } from "../actions";
import { btnSecondary } from "@/lib/ui";

export function CsvControls() {
  async function download() {
    const csv = await exportCsvAction();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "patients.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex items-center gap-2">
      <form action={importCsvAction} className="flex items-center gap-1">
        <input type="file" name="file" accept=".csv" className="text-sm text-slate-600" />
        <button className={btnSecondary}>Import</button>
      </form>
      <button onClick={download} className={btnSecondary}>Export</button>
    </div>
  );
}
```

- [ ] **Step 3: Restyle `LogCheckDrawer`**

Replace `src/app/(app)/patients/_components/LogCheckDrawer.tsx` (keep all field names/options):
```tsx
"use client";
import { logCheckAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function LogCheckDrawer({ patientId }: { patientId: string }) {
  return (
    <form action={logCheckAction} className="flex flex-wrap gap-2 bg-white rounded-2xl border border-slate-200 p-4">
      <input type="hidden" name="patientId" value={patientId} />
      <input name="payer" placeholder="Payer" className={`${inputClass} w-auto`} />
      <select name="status" className={`${inputClass} w-auto`} defaultValue="verified">
        <option value="verified">verified</option><option value="pending">pending</option><option value="inactive">inactive</option>
      </select>
      <input name="copay" type="number" step="0.01" placeholder="Copay" className={`${inputClass} w-24`} />
      <input name="deductible" type="number" step="0.01" placeholder="Deductible left" className={`${inputClass} w-36`} />
      <input name="nextDue" type="date" className={`${inputClass} w-auto`} />
      <input name="notes" placeholder="Notes" className={`${inputClass} w-auto`} />
      <button type="submit" className={btnPrimary}>Log check</button>
    </form>
  );
}
```

- [ ] **Step 4: Restyle the patients list page**

Replace `src/app/(app)/patients/page.tsx` (same data/fetch; PageHeader + table card + Badge):
```tsx
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listPatients } from "@/lib/phi/access";
import { redirect } from "next/navigation";
import { AddPatientForm } from "./_components/AddPatientForm";
import { CsvControls } from "./_components/CsvControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patients = await listPatients(supabase, ctx, {});
  return (
    <div className="space-y-4">
      <PageHeader title="Patients" subtitle={`${patients.length} total`}>
        <CsvControls />
      </PageHeader>
      <AddPatientForm />
      {patients.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">No patients yet.</div>
      ) : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Payer</th><th className={thCell}>Status</th><th className={thCell}>Next due</th></tr></thead>
            <tbody className={tbody}>
              {patients.map((p: any) => (
                <tr key={p.id} className={rowHover}>
                  <td className="px-4 py-4"><Link href={`/patients/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-teal-600">{p.name}</Link></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.primary_payer ?? "—"}</td>
                  <td className="px-4 py-4"><Badge value={p.status} /></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.next_due ?? "—"}</td>
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

- [ ] **Step 5: Restyle the patient detail page**

Replace `src/app/(app)/patients/[id]/page.tsx` (identical data/fetches/actions/fields — only classes + Card/Badge wrappers change):
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { readPatient, listCheckHistory } from "@/lib/phi/access";
import { hasValidConsent, listConsentsForPatient } from "@/lib/phi/consent";
import { redirect, notFound } from "next/navigation";
import { LogCheckDrawer } from "../_components/LogCheckDrawer";
import { resolveCoverage } from "@/lib/payers/resolve";
import { linkPatientPayerAction, grantConsentAction, revokeConsentAction } from "../actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, btnPrimary, btnDangerText, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patient = await readPatient(supabase, ctx, id);
  if (!patient) notFound();
  const [history, consent, orgPayersRes, consents] = await Promise.all([
    listCheckHistory(supabase, ctx, id),
    hasValidConsent(supabase, id),
    supabase.from("payer_directory").select("id, payer_name, payer_master_id").order("payer_name"),
    listConsentsForPatient(supabase, id),
  ]);
  const orgPayers = orgPayersRes.data;
  const payerDirId = (patient as any).primary_payer_directory_id as string | null;
  const linked = payerDirId ? (orgPayers ?? []).find((p: any) => p.id === payerDirId) : null;
  const coverage = linked?.payer_master_id
    ? await resolveCoverage(supabase, linked.payer_master_id as string)
    : [];
  return (
    <div className="space-y-6">
      <PageHeader title={patient.name as string} backHref="/patients" />
      {!consent && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          No valid 42 CFR Part 2 consent on file — disclosure/export is blocked for this patient.
        </div>
      )}
      <LogCheckDrawer patientId={id} />

      <Card title="Primary payer coverage">
        <div className="p-5 space-y-3">
          <form action={linkPatientPayerAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="patientId" value={id} />
            <select name="payerDirectoryId" defaultValue={payerDirId ?? ""} className={`${inputClass} w-auto`}>
              <option value="">— not linked —</option>
              {(orgPayers ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.payer_name}</option>)}
            </select>
            <button className={btnPrimary}>Link payer</button>
          </form>
          {linked && !linked.payer_master_id && (
            <p className="text-sm text-amber-700">Linked payer isn&apos;t mapped to a canonical payer yet — no baseline coverage to show.</p>
          )}
          {coverage.length > 0 && (
            <table className="w-full">
              <thead><tr className={theadRow}><th className={thCell}>CPT</th><th className={thCell}>Covered</th><th className={thCell}>Prior auth</th><th className={thCell}>Source</th></tr></thead>
              <tbody className={tbody}>
                {coverage.map((r) => (
                  <tr key={r.cpt_code} className={rowHover}>
                    <td className="px-4 py-4 text-sm text-slate-900 font-mono">{r.cpt_code}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{r.covered ? "Yes" : "No"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{r.requires_prior_auth ? "Yes" : "No"}</td>
                    <td className="px-4 py-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${r.provenance === "org" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                        {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card title="Consents">
        <div className="p-5 space-y-3">
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>Type</th><th className={thCell}>Scope</th><th className={thCell}>Granted</th><th className={thCell}>Expires</th><th className={thCell}>Status</th><th className={thCell}></th></tr></thead>
            <tbody className={tbody}>
              {consents.map((c) => {
                const active = !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date());
                const status = c.revoked_at ? "revoked" : active ? "active" : "expired";
                return (
                  <tr key={c.id} className={rowHover}>
                    <td className="px-4 py-4 text-sm text-slate-900">{c.consent_type}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{c.scope ?? "—"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{c.granted_at?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{c.expires_at?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-4"><Badge value={status} /></td>
                    <td className="px-4 py-4">{!c.revoked_at && (
                      <form action={revokeConsentAction}>
                        <input type="hidden" name="consentId" value={c.id} />
                        <input type="hidden" name="patientId" value={id} />
                        <button className={btnDangerText}>Revoke</button>
                      </form>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <form action={grantConsentAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="patientId" value={id} />
            <input name="consentType" placeholder="Type (part2_disclosure)" className={`${inputClass} w-auto`} />
            <input name="scope" placeholder="Scope (e.g. billing)" className={`${inputClass} w-auto`} />
            <input name="expiresAt" type="date" className={`${inputClass} w-auto`} />
            <input name="documentRef" placeholder="Document ref" className={`${inputClass} w-auto`} />
            <button className={btnPrimary}>Grant consent</button>
          </form>
        </div>
      </Card>

      <Card title="Eligibility history">
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Date</th><th className={thCell}>Payer</th><th className={thCell}>Status</th><th className={thCell}>Copay</th></tr></thead>
          <tbody className={tbody}>
            {history.map((c: any) => (
              <tr key={c.id} className={rowHover}>
                <td className="px-4 py-4 text-sm text-slate-600">{c.check_date}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.payer}</td>
                <td className="px-4 py-4"><Badge value={c.status} /></td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.copay ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + full suite**

Run:
```bash
npx tsc --noEmit
npm test
```
Expected: `tsc` clean; full suite green unchanged (122). (The patients/consent/coverage actions + field names are untouched, so the action-export smoke tests still pass.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/patients"
git commit -m "feat(ui): restyle patients list, detail, and forms"
```

---

## Task 5: Payers — list, profile, and tab components

**Files:**
- Modify: `src/app/(app)/payers/page.tsx`, `src/app/(app)/payers/[id]/page.tsx`, `src/app/(app)/payers/[id]/_components/{CoveredCodesTab,ClaimRulesTab,EnrolledProvidersTab}.tsx`

**Interfaces:**
- Consumes: `@/lib/ui`, `@/components/ui/{PageHeader,Card,Badge}`. Preserves all override/enrollment form fields + actions + provenance.

- [ ] **Step 1: Restyle the payers list**

Replace `src/app/(app)/payers/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/PageHeader";
import { tableWrap, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

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
      <PageHeader title="Payers" subtitle={`${(payers ?? []).length} total`} />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Payer</th><th className={thCell}>Portal</th><th className={thCell}>Linked</th></tr></thead>
          <tbody className={tbody}>
            {(payers ?? []).map((p: any) => (
              <tr key={p.id} className={rowHover}>
                <td className="px-4 py-4"><Link href={`/payers/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-teal-600">{p.payer_name}</Link></td>
                <td className="px-4 py-4 text-sm">{p.portal_url ? <a href={p.portal_url} target="_blank" rel="noreferrer" className="text-teal-600 hover:text-teal-700 font-medium">Open portal</a> : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-4 text-sm">{p.payer_master_id ? <span className="text-emerald-600">✓</span> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Restyle the payer profile page**

Replace `src/app/(app)/payers/[id]/page.tsx` (same fetches/components/props):
```tsx
export const dynamic = "force-dynamic";
import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { resolveCoverage, resolveClaimRules } from "@/lib/payers/resolve";
import { CoveredCodesTab } from "./_components/CoveredCodesTab";
import { ClaimRulesTab } from "./_components/ClaimRulesTab";
import { listEnrollmentsForPayer, listProviders } from "@/lib/providers/queries";
import { EnrolledProvidersTab } from "./_components/EnrolledProvidersTab";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

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
  const [enrollments, providers] = await Promise.all([
    listEnrollmentsForPayer(supabase, id),
    listProviders(supabase),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={(payer as any).payer_name} backHref="/payers" />
      <Card title="Portal Access">
        <div className="p-5 text-sm space-y-1">
          <p>{(payer as any).portal_url
            ? <a href={(payer as any).portal_url} target="_blank" rel="noreferrer" className="text-teal-600 hover:text-teal-700 font-medium">Open portal</a>
            : <span className="text-slate-400">No portal URL</span>}</p>
          {(payer as any).login_notes && <p className="text-slate-500">{(payer as any).login_notes}</p>}
        </div>
      </Card>
      {!masterId && <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">Link this payer to a canonical payer to see Coverlog&apos;s baseline coverage &amp; claim rules.</p>}
      <EnrolledProvidersTab rows={enrollments} providers={providers} payerDirectoryId={id} isAdmin={ctx.role === "admin"} />
      <CoveredCodesTab rows={coverage} payerMasterId={masterId} payerDirectoryId={id} />
      <ClaimRulesTab rows={rules} payerMasterId={masterId} payerDirectoryId={id} />
    </div>
  );
}
```

- [ ] **Step 3: Restyle `CoveredCodesTab`**

Replace `src/app/(app)/payers/[id]/_components/CoveredCodesTab.tsx` (same props, action, field names):
```tsx
import type { ResolvedCoverage } from "@/lib/payers/resolve";
import { saveOrgCoverageAction } from "../../actions";
import { Card } from "@/components/ui/Card";
import { inputClass, btnPrimary, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export function CoveredCodesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedCoverage[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <Card title="Covered Codes">
      <table className="w-full">
        <thead><tr className={theadRow}><th className={thCell}>CPT</th><th className={thCell}>Covered</th><th className={thCell}>Prior auth</th><th className={thCell}>Modifier</th><th className={thCell}>Source</th></tr></thead>
        <tbody className={tbody}>
          {rows.map((r) => (
            <tr key={r.cpt_code} className={rowHover}>
              <td className="px-4 py-4 text-sm text-slate-900 font-mono">{r.cpt_code}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.covered ? "Yes" : "No"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.requires_prior_auth ? "Yes" : "No"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.modifier_required ?? "—"}</td>
              <td className="px-4 py-4">
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.provenance === "org" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                  {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgCoverageAction} className="flex flex-wrap items-center gap-2 px-5 py-4 border-t border-slate-100">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="cptCode" required placeholder="CPT" className={`${inputClass} w-24`} />
          <label className="text-sm text-slate-600 flex items-center gap-1"><input type="checkbox" name="covered" defaultChecked /> covered</label>
          <label className="text-sm text-slate-600 flex items-center gap-1"><input type="checkbox" name="requiresPriorAuth" /> prior auth</label>
          <input name="modifierRequired" placeholder="Modifier" className={`${inputClass} w-24`} />
          <button className={btnPrimary}>Save override</button>
        </form>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Restyle `ClaimRulesTab`**

Replace `src/app/(app)/payers/[id]/_components/ClaimRulesTab.tsx` (same props, action, field names):
```tsx
import type { ResolvedClaimRule } from "@/lib/payers/resolve";
import { saveOrgClaimRuleAction } from "../../actions";
import { Card } from "@/components/ui/Card";
import { inputClass, btnPrimary, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export function ClaimRulesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedClaimRule[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <Card title="Claim Rules">
      <table className="w-full">
        <thead><tr className={theadRow}><th className={thCell}>Category</th><th className={thCell}>Field</th><th className={thCell}>Rule</th><th className={thCell}>Required</th><th className={thCell}>Source</th></tr></thead>
        <tbody className={tbody}>
          {rows.map((r, i) => (
            <tr key={i} className={rowHover}>
              <td className="px-4 py-4 text-sm text-slate-900">{r.rule_category ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.field_reference ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.rule_description ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.required_value ?? "—"}</td>
              <td className="px-4 py-4">
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.provenance === "org" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                  {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgClaimRuleAction} className="flex flex-wrap gap-2 px-5 py-4 border-t border-slate-100">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="ruleCategory" required placeholder="Category (e.g. modifier)" className={`${inputClass} w-auto`} />
          <input name="fieldReference" placeholder="Box 24J" className={`${inputClass} w-28`} />
          <input name="ruleDescription" placeholder="Rule" className={`${inputClass} w-auto`} />
          <input name="requiredValue" placeholder="Required value" className={`${inputClass} w-auto`} />
          <button className={btnPrimary}>Save override</button>
        </form>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Restyle `EnrolledProvidersTab`**

Replace `src/app/(app)/payers/[id]/_components/EnrolledProvidersTab.tsx` (same props, action, field names; status/PAR via Badge):
```tsx
import type { EnrollmentRow, Provider } from "@/lib/providers/queries";
import { saveEnrollmentAction } from "../../actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, btnPrimary, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export function EnrolledProvidersTab({ rows, providers, payerDirectoryId, isAdmin }:
  { rows: EnrollmentRow[]; providers: Provider[]; payerDirectoryId: string; isAdmin: boolean }) {
  return (
    <Card title="Enrolled Providers">
      <table className="w-full">
        <thead><tr className={theadRow}><th className={thCell}>Provider</th><th className={thCell}>Status</th><th className={thCell}>PAR</th><th className={thCell}>Effective</th><th className={thCell}>Revalidation</th><th className={thCell}>CAQH</th></tr></thead>
        <tbody className={tbody}>
          {rows.map((r) => (
            <tr key={r.id} className={rowHover}>
              <td className="px-4 py-4 text-sm text-slate-900">{r.provider_name}</td>
              <td className="px-4 py-4"><Badge value={r.status} /></td>
              <td className="px-4 py-4">{r.par_status ? <Badge value={r.par_status} /> : <span className="text-sm text-slate-400">—</span>}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.effective_date ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.revalidation_due ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600 font-mono">{r.caqh_id ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && providers.length > 0 && (
        <form action={saveEnrollmentAction} className="flex flex-wrap gap-2 px-5 py-4 border-t border-slate-100">
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <select name="providerId" required className={`${inputClass} w-auto`}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="status" className={`${inputClass} w-auto`}>
            <option value="pending">pending</option><option value="enrolled">enrolled</option>
            <option value="terminated">terminated</option><option value="not_enrolled">not enrolled</option>
          </select>
          <select name="parStatus" className={`${inputClass} w-auto`}>
            <option value="">PAR —</option><option value="in_network">in network</option>
            <option value="out_of_network">out of network</option>
          </select>
          <input name="effectiveDate" type="date" className={`${inputClass} w-auto`} />
          <input name="revalidationDue" type="date" className={`${inputClass} w-auto`} />
          <input name="terminationDate" type="date" className={`${inputClass} w-auto`} />
          <input name="caqhId" placeholder="CAQH ID" className={`${inputClass} w-28`} />
          <button className={btnPrimary}>Save enrollment</button>
        </form>
      )}
    </Card>
  );
}
```

- [ ] **Step 6: Typecheck + full suite**

Run:
```bash
npx tsc --noEmit
npm test
```
Expected: `tsc` clean; full suite green unchanged (122). (`saveOrgCoverageAction`/`saveOrgClaimRuleAction`/`saveEnrollmentAction` field names unchanged → smoke tests pass.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/payers"
git commit -m "feat(ui): restyle payers list, profile, and tabs"
```

---

## Task 6: Providers + Admin + Admin/staff

**Files:**
- Modify: `src/app/(app)/providers/page.tsx`, `src/app/(app)/providers/_components/AddProviderForm.tsx`, `src/app/(app)/admin/page.tsx`, `src/app/(app)/admin/staff/page.tsx`

**Interfaces:**
- Consumes: `@/lib/ui`, `@/components/ui/{PageHeader,Card,Badge}`. Preserves provider/staff actions + field names + admin gates.

- [ ] **Step 1: Restyle `AddProviderForm`**

Replace `src/app/(app)/providers/_components/AddProviderForm.tsx`:
```tsx
import { createProviderAction } from "../actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export function AddProviderForm() {
  return (
    <form action={createProviderAction} className="flex flex-wrap gap-2 bg-white rounded-2xl border border-slate-200 p-4">
      <input name="name" required placeholder="Provider name" className={`${inputClass} w-auto`} />
      <input name="npi" placeholder="NPI" className={`${inputClass} w-32`} />
      <input name="licenseType" placeholder="License (LCSW…)" className={`${inputClass} w-36`} />
      <input name="licenseNumber" placeholder="License #" className={`${inputClass} w-28`} />
      <input name="licenseState" placeholder="State" className={`${inputClass} w-20`} />
      <input name="licenseExpiration" type="date" className={`${inputClass} w-auto`} />
      <button className={btnPrimary}>Add provider</button>
    </form>
  );
}
```

- [ ] **Step 2: Restyle the providers page**

Replace `src/app/(app)/providers/page.tsx` (same data/actions/gates/columns):
```tsx
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listProviders } from "@/lib/providers/queries";
import { AddProviderForm } from "./_components/AddProviderForm";
import { deleteProviderAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { tableWrap, theadRow, thCell, tbody, rowHover, btnDangerText } from "@/lib/ui";

export default async function ProvidersPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const providers = await listProviders(supabase);
  const isAdmin = ctx.role === "admin";
  return (
    <div className="space-y-4">
      <PageHeader title="Providers" subtitle={`${providers.length} total`} />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>NPI</th><th className={thCell}>License</th><th className={thCell}>State</th><th className={thCell}>Expires</th><th className={thCell}></th></tr></thead>
          <tbody className={tbody}>
            {providers.map((p) => (
              <tr key={p.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{p.name}</td>
                <td className="px-4 py-4 text-sm text-slate-600 font-mono">{p.npi ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_type ?? "—"}{p.license_number ? ` ${p.license_number}` : ""}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_state ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_expiration ?? "—"}</td>
                <td className="px-4 py-4">{isAdmin && (
                  <form action={deleteProviderAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className={btnDangerText}>Remove</button>
                  </form>
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

- [ ] **Step 3: Restyle the admin overview page**

Replace `src/app/(app)/admin/page.tsx` (same data/gate; Badge for status):
```tsx
export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listOrgConsents } from "@/lib/phi/access";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export default async function AdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const consents = await listOrgConsents(supabase, ctx);
  return (
    <div className="space-y-4">
      <PageHeader title="Admin">
        <Link href="/admin/staff" className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm">Staff</Link>
      </PageHeader>
      <Card title="Consents">
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Patient</th><th className={thCell}>Type</th><th className={thCell}>Granted</th><th className={thCell}>Expires</th><th className={thCell}>Status</th></tr></thead>
          <tbody className={tbody}>
            {consents.map((c) => (
              <tr key={c.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{c.patient_name}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.consent_type}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.granted_at?.slice(0, 10) ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.expires_at?.slice(0, 10) ?? "—"}</td>
                <td className="px-4 py-4"><Badge value={c.revoked_at ? "revoked" : "active"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Restyle the admin/staff page**

Replace `src/app/(app)/admin/staff/page.tsx` (same gates/actions/field names; role Badge):
```tsx
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listStaff } from "@/lib/staff/queries";
import { setStaffRoleAction, deactivateStaffAction, reactivateStaffAction } from "../actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover, linkTeal, btnDangerText } from "@/lib/ui";

export default async function StaffAdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const staff = await listStaff(supabase);
  return (
    <div className="space-y-4">
      <PageHeader title="Staff" subtitle={`${staff.length} total`} backHref="/admin" />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Email</th><th className={thCell}>Role</th><th className={thCell}>Status</th><th className={thCell}></th></tr></thead>
          <tbody className={tbody}>
            {staff.map((s) => (
              <tr key={s.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{s.email}</td>
                <td className="px-4 py-4">
                  <form action={setStaffRoleAction} className="inline-flex items-center gap-2">
                    <input type="hidden" name="staffId" value={s.id} />
                    <input type="hidden" name="role" value={s.role === "admin" ? "specialist" : "admin"} />
                    <Badge value={s.role} />
                    <button className={`${linkTeal} text-xs`}>→ {s.role === "admin" ? "specialist" : "admin"}</button>
                  </form>
                </td>
                <td className="px-4 py-4"><Badge value={s.deleted_at ? "inactive" : "active"} /></td>
                <td className="px-4 py-4">
                  {s.deleted_at ? (
                    <form action={reactivateStaffAction}>
                      <input type="hidden" name="staffId" value={s.id} />
                      <button className={`${linkTeal} text-xs`}>Reactivate</button>
                    </form>
                  ) : (
                    <form action={deactivateStaffAction}>
                      <input type="hidden" name="staffId" value={s.id} />
                      <button className={btnDangerText}>Deactivate</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + full suite**

Run:
```bash
npx tsc --noEmit
npm test
```
Expected: `tsc` clean; full suite green unchanged (122). (Provider + staff action field names unchanged → smoke tests pass.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/providers" "src/app/(app)/admin"
git commit -m "feat(ui): restyle providers, admin overview, and staff admin"
```

---

## Task 7: Auth pages + final build gate

**Files:**
- Modify: `src/app/sign-in/page.tsx`, `src/app/sign-up/page.tsx`, `src/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `@/lib/ui`. Preserves `signInAction`/`signUpAction`/`submitOnboarding` wiring + field names + `?error=` rendering.

- [ ] **Step 1: Restyle sign-in**

Replace `src/app/sign-in/page.tsx`:
```tsx
import Link from "next/link";
import { signInAction } from "./actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form action={signInAction} className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
          <span className="font-bold text-slate-900">Coverlog</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Sign in</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input name="email" type="email" required placeholder="Email" className={inputClass} />
        <input name="password" type="password" required placeholder="Password" className={inputClass} />
        <button type="submit" className={`${btnPrimary} w-full`}>Sign in</button>
        <p className="text-sm text-slate-500">No account? <Link href="/sign-up" className="text-teal-600 hover:text-teal-700 font-medium">Sign up</Link></p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Restyle sign-up**

Replace `src/app/sign-up/page.tsx`:
```tsx
import Link from "next/link";
import { signUpAction } from "./actions";
import { inputClass, btnPrimary } from "@/lib/ui";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form action={signUpAction} className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
          <span className="font-bold text-slate-900">Coverlog</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Create your account</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input name="email" type="email" required placeholder="Email" className={inputClass} />
        <input name="password" type="password" required placeholder="Password" className={inputClass} />
        <button type="submit" className={`${btnPrimary} w-full`}>Sign up</button>
        <p className="text-sm text-slate-500">Have an account? <Link href="/sign-in" className="text-teal-600 hover:text-teal-700 font-medium">Sign in</Link></p>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Restyle onboarding**

Replace `src/app/onboarding/page.tsx`:
```tsx
import { submitOnboarding } from "./actions";
import { inputClass, labelClass, btnPrimary } from "@/lib/ui";

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form action={submitOnboarding} className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-md space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
          <span className="font-bold text-slate-900">Coverlog</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Set up your clinic</h1>
        <div>
          <label className={labelClass}>Clinic name</label>
          <input name="orgName" required placeholder="Clinic name" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Your name</label>
          <input name="adminName" required placeholder="Your name" className={inputClass} />
        </div>
        <button type="submit" className={`${btnPrimary} w-full`}>Create</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Build gate — typecheck + build + full suite**

Run:
```bash
npx tsc --noEmit
npm run build
npm test
```
Expected: `tsc` clean; `next build` completes with all routes present (`/`, `/dashboard`, `/patients`, `/patients/[id]`, `/payers`, `/payers/[id]`, `/providers`, `/admin`, `/admin/staff`, `/sign-in`, `/sign-up`, `/onboarding`, `/api/cron/*`); full suite green unchanged (122).

- [ ] **Step 5: Commit**

```bash
git add src/app/sign-in src/app/sign-up src/app/onboarding
git commit -m "feat(ui): restyle sign-in, sign-up, and onboarding"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** globals font + metadata (Task 1); shared primitives `ui.ts`/`Badge`/`PageHeader`/`Card` + `statusColor` map (Task 1); sidebar shell + teal accent bar (Task 2); dashboard greeting + tinted cards (Task 3); patients list/detail/forms + consent banner as alert card + provenance chips (Task 4); payers list/profile/tabs + override/enrollment forms (Task 5); providers + admin + staff with role/status badges (Task 6); auth + onboarding centered cards (Task 7). `tests/lib/ui-smoke.test.ts` (Task 1).
- **Safety constraint honored:** every task reproduces the existing form field `name=` attributes, server-action imports/wiring, hidden inputs, hrefs, conditionals (`isAdmin`/`ctx.role` gates, consent banner, provenance, `deleted_at`/status), `params`/`searchParams`, and table columns/data verbatim — only classes + presentational wrappers change. The unchanged full suite (incl. action-export smoke tests) is the regression gate at every task.
- **Type consistency:** `ui.ts` constants and `Badge`/`PageHeader`/`Card` signatures defined in Task 1 are consumed unchanged in Tasks 3–7; `statusColor` keys match the values pages pass (patient/check status, enrollment status, par_status, consent active/revoked/expired, role).
- **Deferred (by design, Plans B/C/D):** functional search, provider status/specialty + Specialty column, mockup dashboard metrics/panels, nav rename. Not in this plan.
- **No deps / no migration.** Tailwind v4 CSS-config and Geist unchanged.

---

## Subsequent Plans
- **B — Provider credentialing fields:** `providers.status` (active/pending/flagged) + `specialty`; Providers table Specialty column + status pill + search; admin set.
- **C — Mockup dashboard:** Total Providers / Expiring Soon / Pending Review / Flagged cards + Pending Verifications + Expiring Credentials panels (needs B).
- **D — Nav/IA rename:** Insurance Eligibility / Insurance Credentialing (its own brainstorm for the mapping).
