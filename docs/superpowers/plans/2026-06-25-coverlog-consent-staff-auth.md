# Coverlog Consent Admin + Staff Management + Minimal Auth UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Coverlog usable end-to-end in a browser (minimal email+password auth) and finish the admin/compliance surface: manage existing staff (roles + activate/deactivate, with a last-admin guard) and administer 42 CFR Part 2 consents (per-patient grant/revoke audited to `disclosure_log`, plus a read-only org consents overview).

**Architecture:** Tested libs + thin server components, RLS-scoped as `authenticated` via the request-bound `createServerSupabase`; `org_id`/`staffId` always from `ctx`, never client input; mutations admin-gated at the server-action layer (RLS stays the tenant boundary); pages set `export const dynamic = "force-dynamic"`. All target tables (`patient_consents`, `disclosure_log`, `staff`) already exist — **no migration**. This is plan 3c of the Module 8 arc (3a payer intelligence ✅ → 3b credentialing ✅ → 3c consent + staff + auth).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind 4, Supabase (Postgres + Auth, `@supabase/ssr`), Vitest, `pg` (DB/RLS integration tests).

## Global Constraints

- **Next.js 16 App Router.** Middleware is `proxy.ts`. Server components by default; action files start with `"use server"`; pages calling Supabase set `export const dynamic = "force-dynamic"`. Page `searchParams` is a `Promise` in Next 16.
- **TypeScript strict.** Path alias `@/*` → `./src/*`.
- **Multi-tenancy:** every query RLS-scoped as `authenticated` via `createServerSupabase`; never the service role on a tenant path; `org_id`/`staffId` from `ctx`, never client input.
- **Admin gating:** staff mutations require `ctx.role === "admin"` (enforced in server actions; RLS is `for all` org-scoped). Consent capture (grant/revoke) is open to all staff (front-desk work, like patient writes).
- **42 CFR Part 2:** consent grant/revoke each append a `disclosure_log` row via `logDisclosure`. The org consents overview surfaces patient names (PHI) and MUST go through `src/lib/phi/access.ts` (logs `access_log`). `disclosure_log` is append-only (insert+select RLS + `audit_append_only` trigger) — never update/delete it.
- **Last-admin invariant:** the org must always retain ≥1 active admin; demoting/deactivating the last active admin throws.
- **No migration.** `patient_consents`/`staff`/`disclosure_log` already carry every written field; `disclosure_log.action` is free text.
- **Tests** auto-load `.env.local` and run serially (`fileParallelism:false`); apply schema with `npm run db:reset` (no schema change here, but the harness still resets). Real-auth tests use `admin.auth.admin.createUser` + `signInWithPassword` and **delete the created user by its captured id** in `afterAll` (NOT `listUsers().find()` — 50-user page cap).

## Foundation this plan builds on (already merged)

- **Tables (org-isolation RLS):** `staff(id, org_id, user_id unique, name, email, role ∈ {admin,specialist} default specialist, created_at, deleted_at)` (RLS `staff_isolation_all`, `for all`); `patient_consents(id, org_id, patient_id, consent_type, scope, granted_at, expires_at, revoked_at, document_ref, created_by→staff(id), created_at)` (RLS `consents_isolation_all`, `for all`); `disclosure_log(id, org_id, patient_id, actor_staff_id, action, purpose, disclosed_to, occurred_at, detail jsonb)` (append-only).
- **Libs:** `getStaffContext`/`StaffContext` (`{orgId, staffId, role:"admin"|"specialist"}`); `createServerSupabase` (SSR client; `setAll` sets cookies in server actions, no-ops in server components); `proxy.ts` refreshes session each request; `src/lib/phi/access.ts` — `readPatient` (logs `view_chart`) and a module-private `logAccess(client, ctx, {action, patient_id?, patient_ids?, query_context?})` writing `access_log`; `src/lib/phi/consent.ts` — `hasValidConsent(client, patientId)`; `src/lib/phi/disclosure.ts` — `logDisclosure(client, ctx, {action, patient_id?, purpose?, disclosed_to?, detail?})` (`ctx` is `PhiContext = {orgId, staffId}`; `StaffContext` is compatible).
- **Patterns:** sibling action files `src/app/(app)/patients/actions.ts` (has `ctxOrRedirect()` returning `{supabase, ctx}`) and `src/app/(app)/providers/actions.ts` (has `adminCtxOrRedirect()`). `(app)/layout.tsx` resolves `ctx` and renders the nav. Top-level `src/app/onboarding/` is OUTSIDE the `(app)` auth gate; `/sign-in` and `/sign-up` must likewise be top-level so unauthenticated users can reach them.
- **Test harness:** `tests/db/helpers.ts` (`pool`, `withClaims`, `asAdmin`, `resetDb`). Real-auth integration pattern in `tests/db/consent-integration.test.ts` and `tests/db/providers.test.ts`.

---

## File Structure

- `src/lib/staff/queries.ts` — `listStaff`.
- `src/lib/staff/mutations.ts` — `setStaffRole`, `deactivateStaff`, `reactivateStaff` (+ last-admin guard).
- `src/app/(app)/admin/page.tsx` — read-only consents overview (admin-only).
- `src/app/(app)/admin/staff/page.tsx` — staff management (admin-only).
- `src/app/(app)/admin/actions.ts` — `setStaffRoleAction`, `deactivateStaffAction`, `reactivateStaffAction`.
- `src/lib/phi/consent.ts` (extend) — `grantConsent`, `revokeConsent`, `listConsentsForPatient`.
- `src/lib/phi/access.ts` (extend) — `listOrgConsents` (logged read).
- `src/app/(app)/patients/[id]/page.tsx` (extend) — chart Consents section.
- `src/app/(app)/patients/actions.ts` (extend) — `grantConsentAction`, `revokeConsentAction`.
- `src/app/sign-in/{page.tsx,actions.ts}`, `src/app/sign-up/{page.tsx,actions.ts}` — auth pages.
- `src/app/(app)/actions.ts` — `signOutAction`.
- `src/app/(app)/layout.tsx` (extend) — Admin link (admin-only) + Sign out button.
- Tests: `tests/db/staff-admin.test.ts`, `tests/db/consent-admin.test.ts`, `tests/lib/admin-auth-smoke.test.ts`.

---

## Task 1: Staff management libs (queries + mutations + last-admin guard)

**Files:**
- Create: `src/lib/staff/queries.ts`, `src/lib/staff/mutations.ts`
- Test: `tests/db/staff-admin.test.ts`

**Interfaces:**
- Produces:
  - `listStaff(client: Pick<SupabaseClient,"from">): Promise<StaffRow[]>` — all staff in org (incl. deleted), ordered by `name`. `StaffRow = { id: string; name: string; email: string; role: "admin"|"specialist"; user_id: string|null; deleted_at: string|null }`.
  - `setStaffRole(client, ctx: StaffContext, staffId: string, role: "admin"|"specialist"): Promise<void>` — throws `cannot remove the last admin` if demoting the only active admin.
  - `deactivateStaff(client, ctx, staffId): Promise<void>` — sets `deleted_at`; throws if deactivating the only active admin.
  - `reactivateStaff(client, ctx, staffId): Promise<void>` — sets `deleted_at = null`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/staff-admin.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listStaff } from "@/lib/staff/queries";
import { setStaffRole, deactivateStaff, reactivateStaff } from "@/lib/staff/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const CTX_A = { orgId: ORG_A, staffId: "x", role: "admin" as const };
let clientA: Awaited<ReturnType<typeof signedIn>>;
let clientB: Awaited<ReturnType<typeof signedIn>>;
let userIdA: string; let userIdB: string;
let adminAId: string; let admin2Id: string; let specId: string; let bStaffId: string;

async function signedIn(email: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  return c;
}

beforeAll(async () => {
  const a = await admin.auth.admin.createUser({ email: "staff-a@example.com", password: "Test-Passw0rd!", email_confirm: true });
  const b = await admin.auth.admin.createUser({ email: "staff-b@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userIdA = a.data!.user!.id; userIdB = b.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    // org A: the signed-in admin (a), a second admin, and a specialist.
    const r1 = await q(`insert into public.staff (org_id, user_id, name, email, role)
                        values ($1,$2,'Al','al@a.com','admin') returning id`, [ORG_A, userIdA]);
    adminAId = r1.rows[0].id;
    const r2 = await q(`insert into public.staff (org_id, name, email, role)
                        values ($1,'Amy','amy@a.com','admin') returning id`, [ORG_A]);
    admin2Id = r2.rows[0].id;
    const r3 = await q(`insert into public.staff (org_id, name, email, role)
                        values ($1,'Sam','sam@a.com','specialist') returning id`, [ORG_A]);
    specId = r3.rows[0].id;
    // org B: its own admin (signed-in b) for cross-org checks.
    const r4 = await q(`insert into public.staff (org_id, user_id, name, email, role)
                        values ($1,$2,'Bo','bo@b.com','admin') returning id`, [ORG_B, userIdB]);
    bStaffId = r4.rows[0].id;
  });
  clientA = await signedIn("staff-a@example.com");
  clientB = await signedIn("staff-b@example.com");
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userIdA);
  await admin.auth.admin.deleteUser(userIdB);
  await asAdmin((q) => q(`truncate table public.staff, public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("staff management", () => {
  it("listStaff returns the org's staff (admins + specialist)", async () => {
    const rows = await listStaff(clientA);
    expect(rows.map((r) => r.name).sort()).toEqual(["Al", "Amy", "Sam"]);
  });

  it("setStaffRole promotes the specialist to admin", async () => {
    await setStaffRole(clientA, CTX_A, specId, "admin");
    const row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.role).toBe("admin");
    await setStaffRole(clientA, CTX_A, specId, "specialist"); // restore
  });

  it("deactivate + reactivate toggles deleted_at", async () => {
    await deactivateStaff(clientA, CTX_A, specId);
    let row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.deleted_at).not.toBeNull();
    await reactivateStaff(clientA, CTX_A, specId);
    row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.deleted_at).toBeNull();
  });

  it("last-admin guard: cannot demote the only active admin", async () => {
    // Deactivate admin2 so adminAId is the sole active admin.
    await deactivateStaff(clientA, CTX_A, admin2Id);
    await expect(setStaffRole(clientA, CTX_A, adminAId, "specialist"))
      .rejects.toThrow(/last admin/i);
    await expect(deactivateStaff(clientA, CTX_A, adminAId))
      .rejects.toThrow(/last admin/i);
    await reactivateStaff(clientA, CTX_A, admin2Id); // restore
  });

  it("another org cannot modify org A's staff (RLS)", async () => {
    await setStaffRole(clientB, { orgId: ORG_B, staffId: "y", role: "admin" }, specId, "admin");
    // RLS scopes the update to org B → org A's specId is untouched.
    const row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.role).toBe("specialist");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/staff-admin.test.ts`
Expected: FAIL — `Cannot find module '@/lib/staff/queries'`.

- [ ] **Step 3: Write the queries**

Create `src/lib/staff/queries.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type StaffRow = {
  id: string; name: string; email: string;
  role: "admin" | "specialist"; user_id: string | null; deleted_at: string | null;
};

export async function listStaff(
  client: Pick<SupabaseClient, "from">,
): Promise<StaffRow[]> {
  const { data, error } = await client.from("staff")
    .select("id, name, email, role, user_id, deleted_at").order("name");
  if (error) throw new Error(`listStaff failed: ${error.message}`);
  return (data ?? []) as StaffRow[];
}
```

- [ ] **Step 4: Write the mutations + last-admin guard**

Create `src/lib/staff/mutations.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

// Throw if the change would remove the org's last active admin. RLS scopes both
// queries to the caller's org, so the count is per-org.
async function assertNotLastAdmin(
  client: Pick<SupabaseClient, "from">, staffId: string,
): Promise<void> {
  const { data: target, error: tErr } = await client.from("staff")
    .select("role, deleted_at").eq("id", staffId).maybeSingle();
  if (tErr) throw new Error(`assertNotLastAdmin failed: ${tErr.message}`);
  // Only removing an ACTIVE admin can drop the admin count.
  if (!target || target.role !== "admin" || target.deleted_at) return;
  const { count, error: cErr } = await client.from("staff")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin").is("deleted_at", null).neq("id", staffId);
  if (cErr) throw new Error(`assertNotLastAdmin failed: ${cErr.message}`);
  if ((count ?? 0) === 0) throw new Error("cannot remove the last admin");
}

export async function setStaffRole(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext,
  staffId: string, role: "admin" | "specialist",
): Promise<void> {
  if (role === "specialist") await assertNotLastAdmin(client, staffId);
  const { error } = await client.from("staff")
    .update({ role }).eq("id", staffId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`setStaffRole failed: ${error.message}`);
}

export async function deactivateStaff(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, staffId: string,
): Promise<void> {
  await assertNotLastAdmin(client, staffId);
  const { error } = await client.from("staff")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", staffId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`deactivateStaff failed: ${error.message}`);
}

export async function reactivateStaff(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, staffId: string,
): Promise<void> {
  const { error } = await client.from("staff")
    .update({ deleted_at: null }).eq("id", staffId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`reactivateStaff failed: ${error.message}`);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- tests/db/staff-admin.test.ts`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/staff/queries.ts src/lib/staff/mutations.ts tests/db/staff-admin.test.ts
git commit -m "feat: staff management libs (list/role/deactivate + last-admin guard)"
```

---

## Task 2: /admin/staff page + admin actions + nav

**Files:**
- Create: `src/app/(app)/admin/staff/page.tsx`, `src/app/(app)/admin/actions.ts`
- Modify: `src/app/(app)/layout.tsx`
- Test: `tests/lib/admin-auth-smoke.test.ts`

**Interfaces:**
- Consumes: Task 1 libs; `createServerSupabase`, `getStaffContext`.
- Produces: admin-only staff page; actions `setStaffRoleAction`, `deactivateStaffAction`, `reactivateStaffAction`.

- [ ] **Step 1: Write the admin actions**

Create `src/app/(app)/admin/actions.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { setStaffRole, deactivateStaff, reactivateStaff } from "@/lib/staff/mutations";

async function adminCtxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  return { supabase, ctx };
}

export async function setStaffRoleAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  const role = String(formData.get("role")) === "admin" ? "admin" : "specialist";
  await setStaffRole(supabase, ctx, String(formData.get("staffId")), role);
  revalidatePath("/admin/staff");
}

export async function deactivateStaffAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await deactivateStaff(supabase, ctx, String(formData.get("staffId")));
  revalidatePath("/admin/staff");
}

export async function reactivateStaffAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await reactivateStaff(supabase, ctx, String(formData.get("staffId")));
  revalidatePath("/admin/staff");
}
```

- [ ] **Step 2: Write the staff page**

Create `src/app/(app)/admin/staff/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listStaff } from "@/lib/staff/queries";
import { setStaffRoleAction, deactivateStaffAction, reactivateStaffAction } from "../actions";

export default async function StaffAdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const staff = await listStaff(supabase);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Staff</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-2">{s.name}</td><td>{s.email}</td>
              <td>
                <form action={setStaffRoleAction} className="inline">
                  <input type="hidden" name="staffId" value={s.id} />
                  <input type="hidden" name="role" value={s.role === "admin" ? "specialist" : "admin"} />
                  <button className="underline">{s.role} → {s.role === "admin" ? "specialist" : "admin"}</button>
                </form>
              </td>
              <td>{s.deleted_at ? "inactive" : "active"}</td>
              <td>
                {s.deleted_at ? (
                  <form action={reactivateStaffAction}>
                    <input type="hidden" name="staffId" value={s.id} />
                    <button className="text-blue-700 underline">Reactivate</button>
                  </form>
                ) : (
                  <form action={deactivateStaffAction}>
                    <input type="hidden" name="staffId" value={s.id} />
                    <button className="text-red-700 underline">Deactivate</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Add the Admin link to the nav**

In `src/app/(app)/layout.tsx`, add inside `<nav>` after the Providers link, gated on admin:
```tsx
        {ctx.role === "admin" && <Link href="/admin">Admin</Link>}
```

- [ ] **Step 4: Smoke test (create the file)**

Create `tests/lib/admin-auth-smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("admin actions module", () => {
  it("exports the staff admin server actions", async () => {
    const mod = await import("@/app/(app)/admin/actions");
    for (const fn of ["setStaffRoleAction", "deactivateStaffAction", "reactivateStaffAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
```

- [ ] **Step 5: Run smoke + typecheck**

Run:
```bash
npm test -- tests/lib/admin-auth-smoke.test.ts
npx tsc --noEmit
```
Expected: smoke passes; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/admin" "src/app/(app)/layout.tsx" tests/lib/admin-auth-smoke.test.ts
git commit -m "feat: admin staff page + role/activation actions + Admin nav link"
```

---

## Task 3: Consent grant/revoke/list libs (+ disclosure logging)

**Files:**
- Modify: `src/lib/phi/consent.ts`
- Test: `tests/db/consent-admin.test.ts`

**Interfaces:**
- Consumes: `logDisclosure` (`@/lib/phi/disclosure`); `StaffContext`.
- Produces:
  - `grantConsent(client, ctx, input): Promise<{ id: string }>` where `input = { patientId; consentType; scope?; expiresAt?; documentRef? }`.
  - `revokeConsent(client, ctx, consentId): Promise<void>`.
  - `listConsentsForPatient(client, patientId): Promise<ConsentRow[]>` — newest first.
  - `ConsentRow = { id: string; consent_type: string; scope: string|null; granted_at: string|null; expires_at: string|null; revoked_at: string|null; document_ref: string|null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/consent-admin.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { grantConsent, revokeConsent, listConsentsForPatient, hasValidConsent } from "@/lib/phi/consent";

const ORG = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userId: string; let userClient: ReturnType<typeof createClient>;
let staffId: string; let patientId: string;
let ctx: { orgId: string; staffId: string; role: "admin" };

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({ email: "consent-admin@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.disclosure_log, public.patient_consents, public.patients,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG]);
    const s = await q(`insert into public.staff (org_id, user_id, name, email, role)
                       values ($1,$2,'Al','al@a.com','admin') returning id`, [ORG, userId]);
    staffId = s.rows[0].id;
    const p = await q(`insert into public.patients (org_id, name) values ($1,'Pat') returning id`, [ORG]);
    patientId = p.rows[0].id;
  });
  ctx = { orgId: ORG, staffId, role: "admin" };
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "consent-admin@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId);
  await asAdmin((q) => q(`truncate table public.disclosure_log, public.patient_consents,
                          public.patients, public.staff, public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("consent admin", () => {
  it("grantConsent inserts a consent row and logs consent_granted", async () => {
    const { id } = await grantConsent(userClient, ctx, { patientId, consentType: "part2_disclosure", scope: "billing" });
    expect(id).toBeTruthy();
    expect(await hasValidConsent(userClient, patientId)).toBe(true);
    const log = await asAdmin(async (q) =>
      (await q(`select action, patient_id from public.disclosure_log where patient_id=$1`, [patientId])).rows);
    expect(log.some((r: any) => r.action === "consent_granted")).toBe(true);
  });

  it("revokeConsent sets revoked_at, flips hasValidConsent false, and logs consent_revoked", async () => {
    const rows = await listConsentsForPatient(userClient, patientId);
    await revokeConsent(userClient, ctx, rows[0].id);
    expect(await hasValidConsent(userClient, patientId)).toBe(false);
    const log = await asAdmin(async (q) =>
      (await q(`select action from public.disclosure_log where patient_id=$1`, [patientId])).rows);
    expect(log.some((r: any) => r.action === "consent_revoked")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/consent-admin.test.ts`
Expected: FAIL — `grantConsent` is not exported from `@/lib/phi/consent`.

- [ ] **Step 3: Extend the consent lib**

Append to `src/lib/phi/consent.ts` (keep the existing imports + `hasValidConsent`; add the `logDisclosure`/`StaffContext` imports at the top alongside the existing `SupabaseClient` type import):
```ts
import { logDisclosure } from "@/lib/phi/disclosure";
import type { StaffContext } from "@/lib/auth/context";

export type ConsentRow = {
  id: string; consent_type: string; scope: string | null;
  granted_at: string | null; expires_at: string | null;
  revoked_at: string | null; document_ref: string | null;
};
export type GrantConsentInput = {
  patientId: string; consentType: string;
  scope?: string; expiresAt?: string; documentRef?: string;
};

export async function grantConsent(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: GrantConsentInput,
): Promise<{ id: string }> {
  const { data, error } = await client.from("patient_consents").insert({
    org_id: ctx.orgId, patient_id: input.patientId, consent_type: input.consentType,
    scope: input.scope ?? null, granted_at: new Date().toISOString(),
    expires_at: input.expiresAt ?? null, document_ref: input.documentRef ?? null,
    created_by: ctx.staffId,
  }).select("id").single();
  if (error) throw new Error(`grantConsent failed: ${error.message}`);
  await logDisclosure(client, ctx, {
    action: "consent_granted", patient_id: input.patientId,
    detail: { consent_type: input.consentType },
  });
  return { id: (data as { id: string }).id };
}

export async function revokeConsent(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, consentId: string,
): Promise<void> {
  const { data: row, error: fErr } = await client.from("patient_consents")
    .select("patient_id").eq("id", consentId).maybeSingle();
  if (fErr) throw new Error(`revokeConsent failed: ${fErr.message}`);
  const { error } = await client.from("patient_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", consentId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`revokeConsent failed: ${error.message}`);
  await logDisclosure(client, ctx, {
    action: "consent_revoked",
    patient_id: (row as { patient_id: string } | null)?.patient_id ?? null,
    detail: { consent_id: consentId },
  });
}

export async function listConsentsForPatient(
  client: Pick<SupabaseClient, "from">, patientId: string,
): Promise<ConsentRow[]> {
  const { data, error } = await client.from("patient_consents")
    .select("id, consent_type, scope, granted_at, expires_at, revoked_at, document_ref")
    .eq("patient_id", patientId).order("created_at", { ascending: false });
  if (error) throw new Error(`listConsentsForPatient failed: ${error.message}`);
  return (data ?? []) as ConsentRow[];
}
```
> `logDisclosure(client, ctx, ...)` accepts `ctx` as `PhiContext = {orgId, staffId}`; `StaffContext` includes both, so passing `ctx` directly typechecks.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/consent-admin.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/phi/consent.ts tests/db/consent-admin.test.ts
git commit -m "feat: consent grant/revoke/list libs with disclosure_log audit"
```

---

## Task 4: Chart consent UI + actions

**Files:**
- Modify: `src/app/(app)/patients/actions.ts`, `src/app/(app)/patients/[id]/page.tsx`
- Test: append to `tests/lib/admin-auth-smoke.test.ts`

**Interfaces:**
- Consumes: Task 3 libs (`grantConsent`, `revokeConsent`, `listConsentsForPatient`); existing `ctxOrRedirect` in `patients/actions.ts`.
- Produces: chart Consents section; actions `grantConsentAction`, `revokeConsentAction`.

- [ ] **Step 1: Add the consent actions**

`src/app/(app)/patients/actions.ts` already imports `revalidatePath` and has `ctxOrRedirect()`. Add the consent-lib import at the top with the others and append these actions:
```ts
import { grantConsent, revokeConsent } from "@/lib/phi/consent";

export async function grantConsentAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await grantConsent(supabase, ctx, {
    patientId: String(formData.get("patientId")),
    consentType: String(formData.get("consentType") ?? "").trim() || "part2_disclosure",
    scope: String(formData.get("scope") ?? "").trim() || undefined,
    expiresAt: String(formData.get("expiresAt") ?? "").trim() || undefined,
    documentRef: String(formData.get("documentRef") ?? "").trim() || undefined,
  });
  revalidatePath(`/patients/${formData.get("patientId")}`);
}

export async function revokeConsentAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await revokeConsent(supabase, ctx, String(formData.get("consentId")));
  revalidatePath(`/patients/${formData.get("patientId")}`);
}
```

- [ ] **Step 2: Add the Consents section to the chart**

In `src/app/(app)/patients/[id]/page.tsx`, add imports:
```tsx
import { listConsentsForPatient } from "@/lib/phi/consent";
import { grantConsentAction, revokeConsentAction } from "../actions";
```
Fetch consents alongside the existing reads — add `listConsentsForPatient(supabase, id)` as another arm of the existing `Promise.all` (it returns `[history, consent, orgPayersRes]` after Plan 3b; add a 4th arm `listConsentsForPatient(supabase, id)` and destructure as `consents`):
```tsx
  const [history, consent, orgPayersRes, consents] = await Promise.all([
    listCheckHistory(supabase, ctx, id),
    hasValidConsent(supabase, id),
    supabase.from("payer_directory").select("id, payer_name, payer_master_id").order("payer_name"),
    listConsentsForPatient(supabase, id),
  ]);
```
Then add a section to the JSX (e.g. after the existing consent banner / before the eligibility history table):
```tsx
      <section className="space-y-2">
        <h2 className="font-medium">Consents</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Type</th><th>Scope</th><th>Granted</th><th>Expires</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {consents.map((c) => {
              const active = !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date());
              return (
                <tr key={c.id} className="border-b">
                  <td className="p-2">{c.consent_type}</td><td>{c.scope ?? "—"}</td>
                  <td>{c.granted_at?.slice(0, 10) ?? "—"}</td><td>{c.expires_at?.slice(0, 10) ?? "—"}</td>
                  <td>{c.revoked_at ? "revoked" : active ? "active" : "expired"}</td>
                  <td>{!c.revoked_at && (
                    <form action={revokeConsentAction}>
                      <input type="hidden" name="consentId" value={c.id} />
                      <input type="hidden" name="patientId" value={id} />
                      <button className="text-red-700 underline">Revoke</button>
                    </form>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <form action={grantConsentAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="patientId" value={id} />
          <input name="consentType" placeholder="Type (part2_disclosure)" className="border p-1" />
          <input name="scope" placeholder="Scope (e.g. billing)" className="border p-1" />
          <input name="expiresAt" type="date" className="border p-1" />
          <input name="documentRef" placeholder="Document ref" className="border p-1" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Grant consent</button>
        </form>
      </section>
```

- [ ] **Step 3: Append to the smoke test**

Append to `tests/lib/admin-auth-smoke.test.ts`:
```ts
describe("patient consent actions module", () => {
  it("exports grantConsentAction + revokeConsentAction", async () => {
    const mod = await import("@/app/(app)/patients/actions");
    for (const fn of ["grantConsentAction", "revokeConsentAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
```

- [ ] **Step 4: Run smoke + typecheck**

Run:
```bash
npm test -- tests/lib/admin-auth-smoke.test.ts
npx tsc --noEmit
```
Expected: 2 describes pass; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/patients" tests/lib/admin-auth-smoke.test.ts
git commit -m "feat: patient-chart consent grant/revoke UI + actions"
```

---

## Task 5: Logged org-consents read + /admin overview page

**Files:**
- Modify: `src/lib/phi/access.ts`
- Create: `src/app/(app)/admin/page.tsx`
- Test: append to `tests/db/consent-admin.test.ts`

**Interfaces:**
- Consumes: existing private `logAccess` in `access.ts`.
- Produces: `listOrgConsents(client, ctx: PhiContext): Promise<OrgConsentRow[]>` — consents joined to patient name, logs a `list_view` access_log entry. `OrgConsentRow = { id: string; patient_id: string; patient_name: string; consent_type: string; granted_at: string|null; expires_at: string|null; revoked_at: string|null }`.

- [ ] **Step 1: Write the failing test (append)**

Append to `tests/db/consent-admin.test.ts` (add the import at the top with the others):
```ts
import { listOrgConsents } from "@/lib/phi/access";

describe("listOrgConsents (logged)", () => {
  it("returns consents joined to patient name and logs a list_view access", async () => {
    // A fresh grant so there is at least one consent for the org.
    await grantConsent(userClient, ctx, { patientId, consentType: "part2_disclosure" });
    const rows = await listOrgConsents(userClient, ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].patient_name).toBe("Pat");
    const access = await asAdmin(async (q) =>
      (await q(`select action from public.access_log where org_id=$1 and action='list_view'`, [ORG])).rows);
    expect(access.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/consent-admin.test.ts`
Expected: FAIL — `listOrgConsents` is not exported from `@/lib/phi/access`.

- [ ] **Step 3: Add the logged read to access.ts**

Append to `src/lib/phi/access.ts` (reuses the module-private `logAccess` and `PhiContext` already defined in the file):
```ts
export type OrgConsentRow = {
  id: string; patient_id: string; patient_name: string; consent_type: string;
  granted_at: string | null; expires_at: string | null; revoked_at: string | null;
};

// Org-wide consents overview joined to patient names (PHI) — therefore logged.
export async function listOrgConsents(
  client: any, ctx: PhiContext,
): Promise<OrgConsentRow[]> {
  const { data } = await client.from("patient_consents")
    .select("id, patient_id, consent_type, granted_at, expires_at, revoked_at, patients!inner(name)")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as any[];
  await logAccess(client, ctx, {
    action: "list_view",
    patient_ids: rows.map((r) => r.patient_id),
    query_context: "admin_consents_overview",
  });
  return rows.map((r) => ({
    id: r.id, patient_id: r.patient_id, patient_name: r.patients?.name ?? "",
    consent_type: r.consent_type, granted_at: r.granted_at,
    expires_at: r.expires_at, revoked_at: r.revoked_at,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/consent-admin.test.ts`
Expected: 3 passing (2 prior + 1 new).

- [ ] **Step 5: Write the /admin overview page**

Create `src/app/(app)/admin/page.tsx`:
```tsx
export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listOrgConsents } from "@/lib/phi/access";

export default async function AdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const consents = await listOrgConsents(supabase, ctx);
  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link href="/admin/staff" className="underline">Staff</Link>
      </div>
      <h2 className="font-medium">Consents</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Patient</th><th>Type</th><th>Granted</th><th>Expires</th><th>Status</th></tr></thead>
        <tbody>
          {consents.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="p-2">{c.patient_name}</td><td>{c.consent_type}</td>
              <td>{c.granted_at?.slice(0, 10) ?? "—"}</td><td>{c.expires_at?.slice(0, 10) ?? "—"}</td>
              <td>{c.revoked_at ? "revoked" : "active"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/phi/access.ts "src/app/(app)/admin/page.tsx" tests/db/consent-admin.test.ts
git commit -m "feat: logged org-consents overview + /admin page"
```

---

## Task 6: Minimal auth UI (sign-in / sign-up / sign-out) + build gate

**Files:**
- Create: `src/app/sign-in/page.tsx`, `src/app/sign-in/actions.ts`, `src/app/sign-up/page.tsx`, `src/app/sign-up/actions.ts`, `src/app/(app)/actions.ts`
- Modify: `src/app/(app)/layout.tsx`
- Test: append to `tests/lib/admin-auth-smoke.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase`.
- Produces: `/sign-in`, `/sign-up` pages; `signInAction`, `signUpAction`, `signOutAction`.

- [ ] **Step 1: Sign-in action + page**

Create `src/app/sign-in/actions.ts`:
```ts
"use server";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function signInAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}
```
Create `src/app/sign-in/page.tsx`:
```tsx
import Link from "next/link";
import { signInAction } from "./actions";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <form action={signInAction} className="mx-auto max-w-sm space-y-3 p-8">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <input name="email" type="email" required placeholder="Email" className="w-full border p-2" />
      <input name="password" type="password" required placeholder="Password" className="w-full border p-2" />
      <button type="submit" className="rounded bg-black px-4 py-2 text-white">Sign in</button>
      <p className="text-sm">No account? <Link href="/sign-up" className="underline">Sign up</Link></p>
    </form>
  );
}
```

- [ ] **Step 2: Sign-up action + page**

Create `src/app/sign-up/actions.ts`:
```ts
"use server";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function signUpAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) redirect(`/sign-up?error=${encodeURIComponent(error.message)}`);
  // If the project requires email confirmation, there's no session yet — try to
  // sign in; on failure, tell the user to confirm via email.
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) redirect(`/sign-in?error=${encodeURIComponent("Check your email to confirm your account.")}`);
  redirect("/onboarding");
}
```
Create `src/app/sign-up/page.tsx`:
```tsx
import Link from "next/link";
import { signUpAction } from "./actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <form action={signUpAction} className="mx-auto max-w-sm space-y-3 p-8">
      <h1 className="text-xl font-semibold">Create your account</h1>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <input name="email" type="email" required placeholder="Email" className="w-full border p-2" />
      <input name="password" type="password" required placeholder="Password" className="w-full border p-2" />
      <button type="submit" className="rounded bg-black px-4 py-2 text-white">Sign up</button>
      <p className="text-sm">Have an account? <Link href="/sign-in" className="underline">Sign in</Link></p>
    </form>
  );
}
```

- [ ] **Step 3: Sign-out action + nav button**

Create `src/app/(app)/actions.ts`:
```ts
"use server";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function signOutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
```
In `src/app/(app)/layout.tsx`, import the action and add a Sign out button at the end of the `<nav>`:
```tsx
import { signOutAction } from "./actions";
```
```tsx
        <form action={signOutAction} className="ml-auto">
          <button className="underline">Sign out</button>
        </form>
```
(The `ml-auto` pushes it to the right; the `<nav>` is already a flex row.)

- [ ] **Step 4: Append to the smoke test**

Append to `tests/lib/admin-auth-smoke.test.ts`:
```ts
describe("auth actions modules", () => {
  it("export signInAction / signUpAction / signOutAction", async () => {
    const signIn = await import("@/app/sign-in/actions");
    const signUp = await import("@/app/sign-up/actions");
    const signOut = await import("@/app/(app)/actions");
    expect(typeof (signIn as any).signInAction).toBe("function");
    expect(typeof (signUp as any).signUpAction).toBe("function");
    expect(typeof (signOut as any).signOutAction).toBe("function");
  });
});
```

- [ ] **Step 5: Build gate — smoke + typecheck + build + full suite**

Run:
```bash
npm test -- tests/lib/admin-auth-smoke.test.ts
npx tsc --noEmit
npm run build
npm test
```
Expected: smoke passes (3 describes); `tsc` clean; `next build` completes with `/sign-in`, `/sign-up`, `/admin`, `/admin/staff` routes; full suite green.

- [ ] **Step 6: Commit**

```bash
git add "src/app/sign-in" "src/app/sign-up" "src/app/(app)/actions.ts" "src/app/(app)/layout.tsx" tests/lib/admin-auth-smoke.test.ts
git commit -m "feat: minimal email/password sign-in, sign-up, sign-out"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** Auth UI (Task 6: sign-in/up/out + nav). Staff management — list/role/activate-deactivate + last-admin guard (Tasks 1–2). Consent grant/revoke + disclosure_log audit (Task 3), chart UI (Task 4). Logged org-consents overview + /admin page (Task 5). Admin nav gating (Task 2). No migration (confirmed — all fields pre-exist).
- **Deferred (by design):** staff invitation (auth-user creation + invite/link) → later plan; email/magic-link/password-reset → later; SES → Plan 4; consent document upload (only `document_ref` text) and consent editing (revoke + re-grant) → out.
- **Type consistency:** `StaffRow` (Task 1) → staff page (Task 2). `StaffContext` consumed by staff + consent mutations. `ConsentRow`/`GrantConsentInput` (Task 3) → chart (Task 4). `OrgConsentRow` (Task 5) → /admin page. `logDisclosure(client, ctx, …)` accepts `StaffContext` (superset of `PhiContext`). `listOrgConsents(client, ctx)` reuses access.ts's private `logAccess`.
- **Security:** staff mutations admin-gated in actions (Task 2) + RLS org-scoping (asserted cross-org in Task 1); consent capture open to all staff (front-desk); org consents overview is the only new PHI-name read and is logged (Task 5). No service role anywhere. `disclosure_log` only ever inserted (append-only honored).
- **Auth-gate placement:** `/sign-in` + `/sign-up` are top-level (outside `(app)`), so unauthenticated users can reach them; `/admin*` is under `(app)` and additionally redirects non-admins.

---

## Subsequent Plans
- **Staff invitation:** service-role invite (create auth user + staff link + acceptance flow), once an invite-token/email path exists.
- **Plan 4 — Email Alerts + ops:** Vercel cron + AWS SES PHI-minimized digests (license-expiring / revalidation-due from 3b; consent expirations from 3c); password reset / magic-link auth; rolling `ensure_access_log_partition` cron (release gate before 2028-12).
