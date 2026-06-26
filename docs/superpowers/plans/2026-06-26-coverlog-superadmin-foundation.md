# Coverlog Superadmin / Platform Foundation (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-level "superadmin" identity (internal Coverlog staff, above org-admin) with a `getPlatformContext()` resolver and a gated top-level `/internal` shell.

**Architecture:** A new `public.superadmins` table (self-read RLS only; otherwise service-role-managed) is the source of truth, with a `SUPERADMIN_EMAILS` env allowlist as the bootstrap path. `getPlatformContext(client)` returns a `PlatformContext` if the signed-in Auth user is in the allowlist or has a `superadmins` row, else `null`. A top-level `/internal` route group (outside the tenant `(app)` group) gates on it.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + Auth via `@supabase/ssr`), TypeScript strict, Vitest (hosted-Supabase harness), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-26-coverlog-superadmin-foundation-design.md`

## Global Constraints

- This is **S1 of three** (S2 org enable/disable, S3 curation follow later). Build **only S1**. Do not add `organizations.status`, a disabled-org gate, in-app superadmin add/remove, or any curation UI.
- Superadmins are Supabase Auth users with **no tenant `staff` row**. `/internal/*` uses `getPlatformContext()`, never `getStaffContext()`.
- `/internal` MUST live outside the `src/app/(app)/` route group (so it does not hit the `(app)` org gate).
- **No service role in S1.** Use the request-bound `createServerSupabase()` only. Do not import `createServiceSupabase`.
- Do not modify tenant auth (`getStaffContext`), the `(app)` shell, or RLS on any tenant table.
- Next is migration **`0016`**. Migrations live in `supabase/migrations/`; apply with `npm run db:reset` (drops+recreates `public`, replays every migration). Tests run against the hosted DB via `npm test` (`vitest run`, serial).
- RLS convention (see `0010_payer_master.sql`): `enable row level security`; narrow policy; `grant select … to authenticated`; `revoke all … from anon`. No write policy ⇒ service-role-only writes.
- TypeScript strict; path alias `@/*` → `./src/*`. Commits end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Migration + `getPlatformContext` resolver

**Files:**
- Create: `supabase/migrations/0016_superadmins.sql`
- Create: `src/lib/auth/platform.ts`
- Test: `tests/db/superadmin.test.ts`

**Interfaces:**
- Consumes: `tests/db/helpers.ts` (`pool`, `asAdmin`, `resetDb`); the real-auth pattern from `tests/db/audit-viewer.test.ts` (`admin.auth.admin.createUser` / `signInWithPassword` / `deleteUser`). `auth.uid()` resolves from the JWT `sub` claim (set by real sign-in).
- Produces: `PlatformContext = { userId: string; email: string }` and `async getPlatformContext(client: Pick<SupabaseClient, "auth" | "from">): Promise<PlatformContext | null>` — consumed by Task 2.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0016_superadmins.sql`:

```sql
-- Platform-level "superadmin" (internal Coverlog staff). NOT org-scoped and NOT a
-- tenant staff member: a Supabase Auth user with elevated, cross-tenant access used
-- by the /internal surface (org management, payer curation). Source of truth for who
-- is a superadmin; the SUPERADMIN_EMAILS env allowlist is an additional bootstrap path.
create table public.superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now()
);

alter table public.superadmins enable row level security;

-- A user may read ONLY their own superadmin row — enough for getPlatformContext()
-- to check its own membership via the request-bound client. No cross-user reads, and
-- no insert/update/delete policy → the table is managed only via the service role
-- (in-app management is a later plan).
create policy superadmins_self_read on public.superadmins
  for select to authenticated using (user_id = auth.uid());

grant select on public.superadmins to authenticated;
revoke all on public.superadmins from anon;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: ends with `Done. Applied 16 migration(s).` and `Applying 0016_superadmins.sql … ok` appears in the output (no error).

- [ ] **Step 3: Write the resolver**

Create `src/lib/auth/platform.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformContext = { userId: string; email: string };

// Resolve the current Supabase Auth user to a platform (superadmin) context.
// Superadmin iff the user's email is in the SUPERADMIN_EMAILS allowlist (bootstrap)
// OR a public.superadmins row exists for them (read via the self-read RLS policy).
// Returns null if unauthenticated or not a superadmin.
export async function getPlatformContext(
  client: Pick<SupabaseClient, "auth" | "from">,
): Promise<PlatformContext | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const email = user.email ?? "";
  const allow = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && allow.includes(email.toLowerCase())) {
    return { userId: user.id, email };
  }

  const { data } = await client
    .from("superadmins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return { userId: user.id, email };
}
```

- [ ] **Step 4: Write the failing test**

Create `tests/db/superadmin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { getPlatformContext } from "@/lib/auth/platform";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const EMAIL_A = "superadmin-a@example.com";
const EMAIL_B = "superadmin-b@example.com";
const ORIG_ALLOW = process.env.SUPERADMIN_EMAILS;

let userA: string; let userB: string;
let clientA: ReturnType<typeof createClient>;

beforeAll(async () => {
  const a = await admin.auth.admin.createUser({ email: EMAIL_A, password: "Test-Passw0rd!", email_confirm: true });
  userA = a.data!.user!.id;
  const b = await admin.auth.admin.createUser({ email: EMAIL_B, password: "Test-Passw0rd!", email_confirm: true });
  userB = b.data!.user!.id;
  clientA = createClient(URL, ANON, { auth: { persistSession: false } });
  await clientA.auth.signInWithPassword({ email: EMAIL_A, password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (ORIG_ALLOW === undefined) delete process.env.SUPERADMIN_EMAILS;
  else process.env.SUPERADMIN_EMAILS = ORIG_ALLOW;
  if (userA) await admin.auth.admin.deleteUser(userA);
  if (userB) await admin.auth.admin.deleteUser(userB);
  await asAdmin((q) => q(`truncate table public.superadmins restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("getPlatformContext", () => {
  it("recognizes a superadmin via the SUPERADMIN_EMAILS allowlist (bootstrap)", async () => {
    process.env.SUPERADMIN_EMAILS = `other@x.com, ${EMAIL_A}`;
    const ctx = await getPlatformContext(clientA);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(userA);
    expect(ctx!.email).toBe(EMAIL_A);
  });

  it("recognizes a superadmin via a superadmins row (self-read RLS)", async () => {
    process.env.SUPERADMIN_EMAILS = "";
    await asAdmin((q) => q(`insert into public.superadmins (user_id, email) values ($1,$2)`, [userA, EMAIL_A]));
    const ctx = await getPlatformContext(clientA);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(userA);
  });

  it("returns null for a signed-in non-superadmin", async () => {
    process.env.SUPERADMIN_EMAILS = "";
    await asAdmin((q) => q(`delete from public.superadmins where user_id = $1`, [userA]));
    const ctx = await getPlatformContext(clientA);
    expect(ctx).toBeNull();
  });

  it("returns null for an anonymous (signed-out) client", async () => {
    process.env.SUPERADMIN_EMAILS = "";
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const ctx = await getPlatformContext(anon);
    expect(ctx).toBeNull();
  });

  it("does not let one user read another user's superadmin row (self-read RLS isolation)", async () => {
    await asAdmin((q) => q(`insert into public.superadmins (user_id, email) values ($1,$2)`, [userB, EMAIL_B]));
    const { data } = await clientA.from("superadmins").select("user_id").eq("user_id", userB);
    expect(data ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- superadmin`
Expected: the `getPlatformContext` describe block passes (5 tests). (The resolver and migration already exist from Steps 1–3, so this is green on first run — that is intended; the value is the behavior coverage, not a red→green flip.)

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; the full suite is green (previous baseline 137 + the 5 new = 142, or however many the suite currently reports — no regressions, no failures).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0016_superadmins.sql src/lib/auth/platform.ts tests/db/superadmin.test.ts
git commit -m "feat: superadmins table + getPlatformContext resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Gated `/internal` shell + landing

**Files:**
- Create: `src/app/internal/layout.tsx`
- Create: `src/app/internal/page.tsx`

**Interfaces:**
- Consumes: `getPlatformContext` + `PlatformContext` from `src/lib/auth/platform.ts` (Task 1); `createServerSupabase` from `src/lib/supabase/server.ts`; `signOutAction` from `src/app/(app)/actions.ts`; `PageHeader` from `src/components/ui/PageHeader.tsx`; `Card` from `src/components/ui/Card.tsx`.
- Produces: the `/internal` route (gated platform area). S2/S3 add `/internal/orgs` and `/internal/curation` under it.

- [ ] **Step 1: Write the internal layout (gate)**

Create `src/app/internal/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPlatformContext } from "@/lib/auth/platform";
import { signOutAction } from "../(app)/actions";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#0d1b2e] text-white">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
            <span className="font-bold">Coverlog · Internal</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-300">{platform.email}</span>
            <form action={signOutAction}>
              <button className="text-slate-300 hover:text-white transition-colors">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write the internal landing page**

Create `src/app/internal/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPlatformContext } from "@/lib/auth/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const TOOLS = [
  { name: "Organizations", desc: "Enable or disable tenant organizations." },
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
              <span className="text-xs font-medium text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">Coming soon</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify `PageHeader` and `Card` props match usage**

Run: `sed -n '1,40p' src/components/ui/PageHeader.tsx src/components/ui/Card.tsx`
Expected: confirm `PageHeader` accepts `title` + optional `subtitle`, and `Card` wraps `children`. If either differs (e.g. `Card` already adds its own padding/border that double up), adjust the JSX in Steps 1–2 to match the real prop shape — do not change the components.

- [ ] **Step 4: Typecheck + build (BUILD GATE)**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds and the route list includes `/internal` (a dynamic `ƒ` route, since `force-dynamic`).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: green (no regressions; S1 added no new runtime behavior to existing tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/internal/layout.tsx src/app/internal/page.tsx
git commit -m "feat: gated /internal platform shell + landing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- After both tasks: dispatch the whole-branch review (most capable model), then finish via `superpowers:finishing-a-development-branch` → merge to main locally + push (per the standing "Always 1" preference).
- If `npm run build` complains about a Suspense boundary or `useSearchParams` in `/internal`, it should not — neither page uses client hooks. If it does, re-check that both files are server components (no `"use client"`).
