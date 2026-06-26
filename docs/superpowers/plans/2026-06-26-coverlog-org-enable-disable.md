# Coverlog Org Enable/Disable (S2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an internal Coverlog superadmin enable/disable a tenant org; a disabled org's staff are bounced to a notice page.

**Architecture:** Add `organizations.status` (text, `active`/`disabled`). The tenant `(app)` layout reads the current org's status (via the existing RLS select policy) and redirects to `/org-disabled` when disabled. A new `src/lib/orgs/admin.ts` (service-role, cross-tenant) backs an `/internal/orgs` superadmin tool whose action re-verifies `getPlatformContext` before writing status via the service role.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + Auth via `@supabase/ssr`), TypeScript strict, Vitest (hosted-Supabase harness), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-26-coverlog-org-enable-disable-design.md`

## Global Constraints

- This is **S2 of three** (S1 superadmin foundation ✅ merged; S3 curation follows). Build **only S2**. Do NOT add curation UI, RLS-level disabled enforcement, separate action/API gating, or any org attribute besides `status`.
- `organizations.status`: `text not null default 'active' check (status in ('active','disabled'))`. Status is changed ONLY via the service role (no tenant update policy) and ONLY inside the superadmin-gated action.
- Enforcement is **app-layer**: the `(app)` layout redirects a disabled org's staff to `/org-disabled`. A disabled-org user stays signed in but every tenant route bounces there.
- **Disabling requires a `window.confirm`** in the UI; enabling is one click.
- `createServiceSupabase()` may be imported ONLY by `/internal/orgs` server code (page + action), which first re-verifies `getPlatformContext`. Never from tenant pages/actions/components or from `src/lib/orgs/admin.ts` itself (the lib takes a passed-in client).
- Next migration is **`0017`** (migrations in `supabase/migrations/`; apply with `npm run db:reset`; test with `npm test`, vitest serial).
- Lib convention (`src/lib/payers/curation.ts`): functions take `Pick<SupabaseClient,"from">` and `throw new Error("<fn> failed: " + error.message)` on a Supabase error.
- TypeScript strict; `@/*` → `./src/*`. Commits end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migration + org-admin lib + app-layer gate + notice page

**Files:**
- Create: `supabase/migrations/0017_org_status.sql`
- Create: `src/lib/orgs/admin.ts`
- Modify: `src/app/(app)/layout.tsx`
- Create: `src/app/org-disabled/page.tsx`
- Test: `tests/db/org-status.test.ts`

**Interfaces:**
- Consumes: `tests/db/helpers.ts` (`pool`, `asAdmin`, `resetDb`); the real-auth + service-client pattern from `tests/db/audit-viewer.test.ts`; `getStaffContext` + `createServerSupabase` (already wired in the layout); `signOutAction` from `src/app/(app)/actions.ts`.
- Produces: `OrgStatus = "active" | "disabled"`, `OrgRow = { id: string; name: string; status: OrgStatus; created_at: string }`, `listAllOrgs(svc: Pick<SupabaseClient,"from">): Promise<OrgRow[]>`, `setOrgStatus(svc: Pick<SupabaseClient,"from">, orgId: string, status: OrgStatus): Promise<void>` — consumed by Task 2.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0017_org_status.sql`:

```sql
-- Org lifecycle status. 'disabled' blocks the org's staff from the tenant app
-- (enforced app-layer in (app)/layout.tsx). Managed only by the service role via
-- the superadmin /internal/orgs surface (organizations has no tenant update policy).
alter table public.organizations
  add column status text not null default 'active' check (status in ('active','disabled'));
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: `Applying 0017_org_status.sql … ok` appears and it ends `Done. Applied 17 migration(s).` (no error).

- [ ] **Step 3: Write the org-admin lib**

Create `src/lib/orgs/admin.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgStatus = "active" | "disabled";
export type OrgRow = { id: string; name: string; status: OrgStatus; created_at: string };

// Cross-tenant list of all organizations. MUST be called with a service-role client
// (bypasses RLS); used only by the superadmin /internal/orgs surface.
export async function listAllOrgs(svc: Pick<SupabaseClient, "from">): Promise<OrgRow[]> {
  const { data, error } = await svc
    .from("organizations")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listAllOrgs failed: ${error.message}`);
  return (data ?? []) as OrgRow[];
}

// Set an org's status. Service-role client; the DB check constraint rejects bad values.
export async function setOrgStatus(
  svc: Pick<SupabaseClient, "from">, orgId: string, status: OrgStatus,
): Promise<void> {
  const { error } = await svc.from("organizations").update({ status }).eq("id", orgId);
  if (error) throw new Error(`setOrgStatus failed: ${error.message}`);
}
```

- [ ] **Step 4: Add the app-layer gate to the `(app)` layout**

Modify `src/app/(app)/layout.tsx` — insert the status check immediately after the existing `if (!ctx) redirect("/onboarding");` line. The full file becomes:

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
  const { data: org } = await supabase
    .from("organizations").select("status").eq("id", ctx.orgId).maybeSingle();
  if (org?.status === "disabled") redirect("/org-disabled");
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

- [ ] **Step 5: Write the notice page**

Create `src/app/org-disabled/page.tsx`:

```tsx
import { signOutAction } from "../(app)/actions";

export default function OrgDisabledPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-8 text-center space-y-4">
        <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto text-amber-600 text-xl">⚠</div>
        <h1 className="text-xl font-bold text-slate-900">Access suspended</h1>
        <p className="text-sm text-slate-500">
          Your organization&rsquo;s access has been suspended. Please contact Coverlog to restore it.
        </p>
        <form action={signOutAction}>
          <button className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the test**

Create `tests/db/org-status.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listAllOrgs, setOrgStatus } from "@/lib/orgs/admin";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let userId: string;
let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  const created = await service.auth.admin.createUser({ email: "org-status@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Alice','a@a.com','admin')`, [ORG_A, userId]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "org-status@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (userId) await service.auth.admin.deleteUser(userId);
  await resetDb();
  await pool.end();
});

describe("org status", () => {
  it("defaults new orgs to 'active'", async () => {
    const rows = await asAdmin(async (q) =>
      (await q(`select status from public.organizations where id=$1`, [ORG_A])).rows);
    expect(rows[0].status).toBe("active");
  });

  it("setOrgStatus flips status (service role)", async () => {
    await setOrgStatus(service, ORG_B, "disabled");
    let rows = await asAdmin(async (q) => (await q(`select status from public.organizations where id=$1`, [ORG_B])).rows);
    expect(rows[0].status).toBe("disabled");
    await setOrgStatus(service, ORG_B, "active");
    rows = await asAdmin(async (q) => (await q(`select status from public.organizations where id=$1`, [ORG_B])).rows);
    expect(rows[0].status).toBe("active");
  });

  it("setOrgStatus rejects an invalid status (check constraint)", async () => {
    await expect(setOrgStatus(service, ORG_B, "bogus" as any)).rejects.toThrow();
  });

  it("listAllOrgs returns all orgs across tenants with their statuses", async () => {
    await setOrgStatus(service, ORG_A, "active");
    await setOrgStatus(service, ORG_B, "disabled");
    const orgs = await listAllOrgs(service);
    const a = orgs.find((o) => o.id === ORG_A)!;
    const b = orgs.find((o) => o.id === ORG_B)!;
    expect(a.status).toBe("active");
    expect(b.status).toBe("disabled");
  });

  it("a tenant can read its own org status but not another org's (RLS)", async () => {
    const own = await userClient.from("organizations").select("status").eq("id", ORG_A).maybeSingle();
    expect(own.data).not.toBeNull();
    const other = await userClient.from("organizations").select("status").eq("id", ORG_B).maybeSingle();
    expect(other.data).toBeNull();
  });
});
```

- [ ] **Step 7: Run the test**

Run: `npm test -- org-status`
Expected: the `org status` block passes (5 tests).

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; full suite green (previous 142 + 5 new = 147; no regressions).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0017_org_status.sql src/lib/orgs/admin.ts "src/app/(app)/layout.tsx" src/app/org-disabled/page.tsx tests/db/org-status.test.ts
git commit -m "feat: organizations.status + app-layer disabled-org gate + notice page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `/internal/orgs` superadmin tool + landing link

**Files:**
- Create: `src/app/internal/orgs/page.tsx`
- Create: `src/app/internal/orgs/actions.ts`
- Create: `src/app/internal/orgs/_components/DisableButton.tsx`
- Modify: `src/app/internal/page.tsx`

**Interfaces:**
- Consumes: `listAllOrgs`, `setOrgStatus`, `OrgStatus` from `src/lib/orgs/admin.ts` (Task 1); `getPlatformContext` from `src/lib/auth/platform.ts`; `createServerSupabase` (`src/lib/supabase/server.ts`); `createServiceSupabase` (`src/lib/supabase/service.ts`); `PageHeader`, `Card`, `Badge`; `tableWrap, theadRow, thCell, tbody, rowHover` from `@/lib/ui`.
- Produces: the `/internal/orgs` route.

- [ ] **Step 1: Write the server action**

Create `src/app/internal/orgs/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { setOrgStatus, type OrgStatus } from "@/lib/orgs/admin";

export async function setOrgStatusAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in"); // re-verify superadmin; never trust the client
  const orgId = String(formData.get("orgId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!orgId || (status !== "active" && status !== "disabled")) return;
  await setOrgStatus(createServiceSupabase(), orgId, status as OrgStatus);
  revalidatePath("/internal/orgs");
}
```

- [ ] **Step 2: Write the confirm-on-disable button**

Create `src/app/internal/orgs/_components/DisableButton.tsx`:

```tsx
"use client";

export function DisableButton() {
  return (
    <button
      type="submit"
      className="text-red-500 hover:text-red-600 text-sm font-medium"
      onClick={(e) => {
        if (!window.confirm("Disable this organization? Its staff will be locked out until re-enabled.")) {
          e.preventDefault();
        }
      }}
    >
      Disable
    </button>
  );
}
```

- [ ] **Step 3: Write the `/internal/orgs` page**

Create `src/app/internal/orgs/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { listAllOrgs } from "@/lib/orgs/admin";
import { setOrgStatusAction } from "./actions";
import { DisableButton } from "./_components/DisableButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function InternalOrgsPage() {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const orgs = await listAllOrgs(createServiceSupabase());
  return (
    <div className="space-y-4">
      <PageHeader title="Organizations" subtitle={`${orgs.length} total`} backHref="/internal" />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Status</th><th className={thCell}>Created</th><th className={thCell}>Action</th></tr></thead>
          <tbody className={tbody}>
            {orgs.map((o) => (
              <tr key={o.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{o.name}</td>
                <td className="px-4 py-4"><Badge value={o.status} /></td>
                <td className="px-4 py-4 text-sm text-slate-600">{o.created_at.slice(0, 10)}</td>
                <td className="px-4 py-4">
                  <form action={setOrgStatusAction}>
                    <input type="hidden" name="orgId" value={o.id} />
                    <input type="hidden" name="status" value={o.status === "active" ? "disabled" : "active"} />
                    {o.status === "active"
                      ? <DisableButton />
                      : <button className="text-teal-600 hover:text-teal-700 text-sm font-medium">Enable</button>}
                  </form>
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

- [ ] **Step 4: Wire the landing "Organizations" row to a link**

Overwrite `src/app/internal/page.tsx` with (adds a `Link` import + an optional `href` on the tool, rendering a link when present):

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPlatformContext } from "@/lib/auth/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const TOOLS: { name: string; desc: string; href?: string }[] = [
  { name: "Organizations", desc: "Enable or disable tenant organizations.", href: "/internal/orgs" },
  { name: "Payer Curation", desc: "Curate the master payer list and baseline coverage / claim rules." },
];

export default async function InternalHome() {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  return (
    <div className="space-y-4">
      <PageHeader title="Internal" subtitle={platform.email} />
      <Card>
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Tools</h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {TOOLS.map((t) => (
            <li key={t.name} className="px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900">{t.name}</div>
                <div className="text-sm text-slate-500">{t.desc}</div>
              </div>
              {t.href ? (
                <Link href={t.href} className="text-teal-600 hover:text-teal-700 text-sm font-medium">Open</Link>
              ) : (
                <span className="text-xs font-medium text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">Coming soon</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + build (BUILD GATE)**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds; the route list includes `/internal/orgs` (dynamic `ƒ`) and `/org-disabled` (static or dynamic — either is fine).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: green (no regressions; Task 2 adds UI only, no new DB behavior).

- [ ] **Step 7: Commit**

```bash
git add src/app/internal/orgs/page.tsx src/app/internal/orgs/actions.ts src/app/internal/orgs/_components/DisableButton.tsx src/app/internal/page.tsx
git commit -m "feat: /internal/orgs enable/disable tool + landing link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- After both tasks: dispatch the whole-branch review (most capable model), then finish via `superpowers:finishing-a-development-branch` → merge to main locally + push (per the standing "Always 1" preference).
- The DB test mutates org status; it truncates `staff`/`organizations` in `beforeAll` and `resetDb()` in `afterAll`, so it's repeatable. It does not touch `SUPERADMIN_EMAILS`.
