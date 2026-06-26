# Coverlog Email Alert Digests + Rolling Ops Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two unattended scheduled jobs — a weekly per-org PHI-minimized email digest (AWS SES) of actionable counts, and a rolling `access_log` partition cron that auto-extends the runway so PHI reads never break.

**Architecture:** Two Vercel Cron jobs hit `CRON_SECRET`-guarded Next route handlers backed by tested libs. The digest job runs with no user session, so per-org counts come from a new `SECURITY DEFINER` SQL function taking `p_org_id` (RLS-scoped `INVOKER` functions like `dashboard_stats` return nothing without a session). PHI never enters email — bodies are built only from aggregate counts + a login link. Service role is used ONLY on these off-tenant cron paths. This is Plan 4 of the roadmap (Plans 1–3c merged).

**Tech Stack:** Next.js 16 (App Router route handlers), TypeScript strict, Supabase (Postgres + service-role client), AWS SES (`@aws-sdk/client-sesv2`), Vercel Cron, Vitest, `pg`.

## Global Constraints

- **Next.js 16 App Router.** Route handlers export `GET`/`POST`; set `export const dynamic = "force-dynamic"` on cron routes. TS strict; path alias `@/*` → `./src/*`.
- **Service role only on off-tenant cron paths.** `createServiceSupabase()` (`src/lib/supabase/service.ts`, BYPASSES RLS) is imported ONLY by cron/digest code — never tenant pages/actions.
- **PHI minimization:** email bodies contain ONLY aggregate integer counts, the org name, and a login link — never patient names, member IDs, DOB, or provider names. Digests are internal aggregate counts to the org's own admins → NOT a 42 CFR Part 2 disclosure → no `disclosure_log` write.
- **Graceful degradation:** `sendEmail` no-ops (returns `{sent:false, skipped:true}`) when AWS creds / `SES_FROM_ADDRESS` are missing — never throws on missing config (shared project convention).
- **Cron auth:** every cron route returns `401` unless `Authorization: Bearer ${CRON_SECRET}` matches and `CRON_SECRET` is set.
- **Alert window:** 60 days for licenses/revalidations/consents; `due_this_week` = `next_due` in `[current_date, current_date+7]`; all anchored to DB `current_date`.
- **Migrations** continue at `0013`; apply with `npm run db:reset` (drops/recreates `public`, re-applies all migrations in order, restoring default role grants). Tests auto-load `.env.local`, run serially (`fileParallelism:false`).
- **SECURITY DEFINER functions** set `search_path = public, pg_temp`, `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`.

## Foundation this plan builds on (already merged)

- `public.ensure_access_log_partition(p_month date)` (`SECURITY DEFINER`, idempotent) — creates one locked-down monthly `access_log` partition; runway provisioned through 2028-12 (migration `0007`). The PHI access layer THROWS on a failed `access_log` insert, so a missing partition breaks all reads.
- `dashboard_stats()` (`0009`, `SECURITY INVOKER`): `(verified_today, due_this_week, needs_attention)` over `patients`. `credentialing_stats()` (`0012`, `SECURITY INVOKER`): `(licenses_expiring, revalidations_due)`. Both session-bound — reused here only as the windowing reference, not called by the system job.
- Tables: `providers(org_id, license_expiration, deleted_at)`; `payer_enrollments(org_id, revalidation_due, status)`; `patient_consents(org_id, expires_at, revoked_at)`; `patients(org_id, next_due, status, deleted_at)`; `staff(org_id, email, role, deleted_at)`; `organizations(id, name)`.
- `createServiceSupabase()` (`src/lib/supabase/service.ts`). Test harness `tests/db/helpers.ts` (`pool`, `asAdmin`, `withClaims`, `resetDb`); `npm run db:reset`.

---

## File Structure

- `supabase/migrations/0013_alerts_ops.sql` — `org_alert_counts(uuid)` + `ensure_upcoming_access_log_partitions(int)` (`SECURITY DEFINER` + grants).
- `src/lib/email/digest.ts` — pure: `AlertCounts`, `shouldSendDigest`, `buildOrgDigest`.
- `src/lib/email/ses.ts` — `sendEmail` (SES; graceful no-op).
- `src/lib/cron/auth.ts` — `cronAuthorized(req)`.
- `src/lib/email/runDigest.ts` — `runWeeklyDigest` orchestration (injectable send/client).
- `src/app/api/cron/weekly-digest/route.ts`, `src/app/api/cron/ensure-partitions/route.ts` — guarded cron routes.
- `vercel.json` (crons), `.env.local.example` (extend), `package.json` (+`@aws-sdk/client-sesv2`).
- Tests: `tests/db/alerts-ops.test.ts`, `tests/lib/digest-content.test.ts`, `tests/lib/cron-auth.test.ts`, `tests/lib/ses-skip.test.ts`, `tests/db/run-digest.test.ts`.

---

## Task 1: Migration 0013 — org_alert_counts + ensure_upcoming_access_log_partitions

**Files:**
- Create: `supabase/migrations/0013_alerts_ops.sql`
- Test: `tests/db/alerts-ops.test.ts`

**Interfaces:**
- Produces (DB):
  - `public.org_alert_counts(p_org_id uuid) returns table (licenses_expiring bigint, revalidations_due bigint, consents_expiring bigint, due_this_week bigint, needs_attention bigint)` — `SECURITY DEFINER`; counts for one org, windowed to `current_date`. Execute revoked from public/anon/authenticated, granted to service_role.
  - `public.ensure_upcoming_access_log_partitions(p_months int) returns int` — `SECURITY DEFINER`; calls `ensure_access_log_partition` for months `0..p_months` from the current month; returns `p_months + 1`. Same grants.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0013_alerts_ops.sql`:
```sql
-- Per-org alert counts for the weekly digest. SECURITY DEFINER (the cron runs as
-- the service role with no user session, so an INVOKER function would see nothing);
-- isolation comes from the explicit p_org_id filter, not RLS. Execute is locked to
-- the service role so a tenant can't read another org's counts.
create or replace function public.org_alert_counts(p_org_id uuid)
  returns table (licenses_expiring bigint, revalidations_due bigint,
                 consents_expiring bigint, due_this_week bigint, needs_attention bigint)
  language sql security definer set search_path = public, pg_temp as $$
  select
    (select count(*) from public.providers
       where org_id = p_org_id and deleted_at is null
         and license_expiration is not null and license_expiration <= current_date + 60),
    (select count(*) from public.payer_enrollments
       where org_id = p_org_id and revalidation_due is not null
         and revalidation_due <= current_date + 60 and status <> 'terminated'),
    (select count(*) from public.patient_consents
       where org_id = p_org_id and revoked_at is null
         and expires_at is not null and expires_at <= current_date + 60),
    (select count(*) from public.patients
       where org_id = p_org_id and deleted_at is null
         and next_due between current_date and current_date + 7),
    (select count(*) from public.patients
       where org_id = p_org_id and deleted_at is null
         and status in ('pending','inactive'));
$$;

revoke all on function public.org_alert_counts(uuid) from public, anon, authenticated;
grant execute on function public.org_alert_counts(uuid) to service_role;

-- Roll the access_log partition runway forward: ensure partitions for the current
-- month through current+p_months exist (idempotent; reuses the locked-down creator).
create or replace function public.ensure_upcoming_access_log_partitions(p_months int)
  returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare m int;
begin
  for m in 0..p_months loop
    perform public.ensure_access_log_partition(
      (date_trunc('month', current_date) + (m || ' months')::interval)::date);
  end loop;
  return p_months + 1;
end;
$$;

revoke all on function public.ensure_upcoming_access_log_partitions(int) from public, anon, authenticated;
grant execute on function public.ensure_upcoming_access_log_partitions(int) to service_role;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: applies cleanly through `0013`.

- [ ] **Step 3: Write the failing test**

Create `tests/db/alerts-ops.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.patient_consents,
             public.patients, public.payer_directory, public.staff, public.organizations
             restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    // ORG_A: one of each signal INSIDE the window, plus out-of-window noise.
    await q(`insert into public.providers (org_id, name, license_expiration)
             values ($1,'DrIn', current_date + 30),($1,'DrOut', current_date + 90)`, [ORG_A]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name) values ($1,'Aetna') returning id`, [ORG_A]);
    const pr = await q(`insert into public.providers (org_id, name) values ($1,'DrEnr') returning id`, [ORG_A]);
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 10),
                    ($1,$2,$3,'terminated', current_date + 5)`, [ORG_A, pr.rows[0].id, pd.rows[0].id]);
    const pat = await q(`insert into public.patients (org_id, name, status, next_due)
             values ($1,'PatDue','verified', current_date + 3),
                    ($1,'PatPending','pending', null),
                    ($1,'PatFar','verified', current_date + 30) returning id`, [ORG_A]);
    await q(`insert into public.patient_consents (org_id, patient_id, consent_type, expires_at)
             values ($1,$2,'part2', current_date + 20),($1,$2,'part2', current_date + 200)`,
            [ORG_A, pat.rows[0].id]);
    // ORG_B: rows that WOULD count if isolation leaked.
    await q(`insert into public.providers (org_id, name, license_expiration) values ($1,'BIn', current_date + 5)`, [ORG_B]);
    await q(`insert into public.patients (org_id, name, status, next_due) values ($1,'BPat','pending', current_date + 1)`, [ORG_B]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers, public.patient_consents,
                          public.patients, public.payer_directory restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("org_alert_counts", () => {
  it("counts each signal for the org and excludes other orgs", async () => {
    const row = await asAdmin(async (q) =>
      (await q(`select * from public.org_alert_counts($1)`, [ORG_A])).rows[0]);
    expect(Number(row.licenses_expiring)).toBe(1);   // DrIn(30) yes, DrOut(90) no
    expect(Number(row.revalidations_due)).toBe(1);   // enrolled(10) yes, terminated(5) no
    expect(Number(row.consents_expiring)).toBe(1);   // 20d yes, 200d no
    expect(Number(row.due_this_week)).toBe(1);       // PatDue(3) yes, PatFar(30) no
    expect(Number(row.needs_attention)).toBe(1);     // PatPending
  });

  it("returns zeros for an org with no matching rows (isolation)", async () => {
    // ORG_B has a license(5) and a pending patient, but querying ORG_A must not see them;
    // querying a third unknown org returns all zeros.
    const zero = await asAdmin(async (q) =>
      (await q(`select * from public.org_alert_counts('33333333-3333-3333-3333-333333333333')`)).rows[0]);
    expect(Number(zero.licenses_expiring)).toBe(0);
    expect(Number(zero.needs_attention)).toBe(0);
  });
});

describe("ensure_upcoming_access_log_partitions", () => {
  it("creates partitions past the existing runway and is idempotent", async () => {
    // 36 months out is past the 2028-12 runway → a fresh partition.
    const suffix = await asAdmin(async (q) =>
      (await q(`select to_char(date_trunc('month', current_date) + interval '36 months', 'YYYY_MM') as s`)).rows[0].s);
    const tbl = `access_log_${suffix}`;
    const before = await asAdmin(async (q) =>
      (await q(`select to_regclass($1) as t`, [`public.${tbl}`])).rows[0].t);
    expect(before).toBeNull();
    await asAdmin((q) => q(`select public.ensure_upcoming_access_log_partitions(36)`));
    const after = await asAdmin(async (q) =>
      (await q(`select relforcerowsecurity from pg_class where relname=$1`, [tbl])).rows);
    expect(after.length).toBe(1);
    expect(after[0].relforcerowsecurity).toBe(true);
    // Idempotent: a second run does not error.
    await asAdmin((q) => q(`select public.ensure_upcoming_access_log_partitions(36)`));
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/db/alerts-ops.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0013_alerts_ops.sql tests/db/alerts-ops.test.ts
git commit -m "feat: org_alert_counts + ensure_upcoming_access_log_partitions (alerts/ops SQL)"
```

---

## Task 2: Digest content lib (pure)

**Files:**
- Create: `src/lib/email/digest.ts`
- Test: `tests/lib/digest-content.test.ts`

**Interfaces:**
- Produces:
  - `AlertCounts = { licensesExpiring: number; revalidationsDue: number; consentsExpiring: number; dueThisWeek: number; needsAttention: number }`.
  - `shouldSendDigest(counts: AlertCounts): boolean` — true iff any count > 0.
  - `buildOrgDigest(orgName: string, counts: AlertCounts, appUrl: string): { subject: string; html: string; text: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/digest-content.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { shouldSendDigest, buildOrgDigest, type AlertCounts } from "@/lib/email/digest";

const ZERO: AlertCounts = { licensesExpiring: 0, revalidationsDue: 0, consentsExpiring: 0, dueThisWeek: 0, needsAttention: 0 };

describe("shouldSendDigest", () => {
  it("is false when all counts are zero", () => {
    expect(shouldSendDigest(ZERO)).toBe(false);
  });
  it("is true when any count is positive", () => {
    expect(shouldSendDigest({ ...ZERO, consentsExpiring: 2 })).toBe(true);
  });
});

describe("buildOrgDigest", () => {
  const counts: AlertCounts = { licensesExpiring: 3, revalidationsDue: 1, consentsExpiring: 2, dueThisWeek: 4, needsAttention: 5 };
  const out = buildOrgDigest("Maple Clinic", counts, "https://app.example/dashboard");

  it("puts the org name in the subject", () => {
    expect(out.subject).toContain("Maple Clinic");
  });
  it("includes every count and the login link in the text body", () => {
    for (const n of ["3", "1", "2", "4", "5"]) expect(out.text).toContain(n);
    expect(out.text).toContain("https://app.example/dashboard");
    expect(out.html).toContain("https://app.example/dashboard");
  });
  it("is PHI-minimized: body mentions only counts/labels/link, no patient fields", () => {
    // Built solely from orgName + integer counts + url, so no PHI tokens can appear.
    expect(out.text.toLowerCase()).not.toMatch(/member id|date of birth|\bdob\b|ssn/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/lib/digest-content.test.ts`
Expected: FAIL — `Cannot find module '@/lib/email/digest'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/email/digest.ts`:
```ts
export type AlertCounts = {
  licensesExpiring: number;
  revalidationsDue: number;
  consentsExpiring: number;
  dueThisWeek: number;
  needsAttention: number;
};

export function shouldSendDigest(counts: AlertCounts): boolean {
  return Object.values(counts).some((n) => n > 0);
}

const LABELS: Array<[keyof AlertCounts, string]> = [
  ["licensesExpiring", "Provider licenses expiring (≤60 days)"],
  ["revalidationsDue", "Payer enrollment revalidations due (≤60 days)"],
  ["consentsExpiring", "Patient consents expiring (≤60 days)"],
  ["dueThisWeek", "Eligibility re-checks due this week"],
  ["needsAttention", "Patients needing attention"],
];

export function buildOrgDigest(
  orgName: string, counts: AlertCounts, appUrl: string,
): { subject: string; html: string; text: string } {
  const lines = LABELS.map(([k, label]) => `${label}: ${counts[k]}`);
  const subject = `Coverlog weekly summary — ${orgName}`;
  const text = [
    `Weekly summary for ${orgName}`,
    "",
    ...lines,
    "",
    `Open Coverlog: ${appUrl}`,
  ].join("\n");
  const html = [
    `<h2>Weekly summary for ${orgName}</h2>`,
    "<ul>",
    ...LABELS.map(([k, label]) => `<li>${label}: <strong>${counts[k]}</strong></li>`),
    "</ul>",
    `<p><a href="${appUrl}">Open Coverlog</a></p>`,
  ].join("");
  return { subject, html, text };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/lib/digest-content.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/digest.ts tests/lib/digest-content.test.ts
git commit -m "feat: PHI-minimized weekly digest content builder"
```

---

## Task 3: SES wrapper + cron auth helper (+ AWS SDK dep)

**Files:**
- Create: `src/lib/email/ses.ts`, `src/lib/cron/auth.ts`
- Modify: `package.json` (+`@aws-sdk/client-sesv2`)
- Test: `tests/lib/ses-skip.test.ts`, `tests/lib/cron-auth.test.ts`

**Interfaces:**
- Produces:
  - `sendEmail({ to: string[]; subject: string; html: string; text: string }): Promise<{ sent: boolean; skipped?: boolean }>` — SES send; `{sent:false, skipped:true}` when `SES_FROM_ADDRESS` or `AWS_ACCESS_KEY_ID` absent.
  - `cronAuthorized(req: Request): boolean` — `Authorization: Bearer ${CRON_SECRET}` check.

- [ ] **Step 1: Install the AWS SDK**

Run: `npm install @aws-sdk/client-sesv2`
Expected: adds the dependency to `package.json` + `package-lock.json`.

- [ ] **Step 2: Write the failing tests**

Create `tests/lib/cron-auth.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { cronAuthorized } from "@/lib/cron/auth";

const orig = process.env.CRON_SECRET;
afterEach(() => { process.env.CRON_SECRET = orig; });

function req(auth?: string) {
  return new Request("https://x/api/cron/weekly-digest",
    auth ? { headers: { authorization: auth } } : undefined);
}

describe("cronAuthorized", () => {
  it("accepts the correct Bearer token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(cronAuthorized(req("Bearer s3cret"))).toBe(true);
  });
  it("rejects a wrong or missing token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(cronAuthorized(req("Bearer nope"))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });
  it("rejects everything when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(cronAuthorized(req("Bearer s3cret"))).toBe(false);
  });
});
```

Create `tests/lib/ses-skip.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { sendEmail } from "@/lib/email/ses";

const origFrom = process.env.SES_FROM_ADDRESS;
afterEach(() => { process.env.SES_FROM_ADDRESS = origFrom; });

describe("sendEmail graceful no-op", () => {
  it("skips (does not throw) when SES_FROM_ADDRESS is unset", async () => {
    delete process.env.SES_FROM_ADDRESS;
    const res = await sendEmail({ to: ["a@b.com"], subject: "s", html: "<p>h</p>", text: "h" });
    expect(res).toEqual({ sent: false, skipped: true });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- tests/lib/cron-auth.test.ts tests/lib/ses-skip.test.ts`
Expected: FAIL — modules `@/lib/cron/auth` and `@/lib/email/ses` not found.

- [ ] **Step 4: Write the cron auth helper**

Create `src/lib/cron/auth.ts`:
```ts
// Vercel injects `Authorization: Bearer ${CRON_SECRET}` on cron invocations when
// CRON_SECRET is configured. Reject everything if it is unset (fail closed).
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
```

- [ ] **Step 5: Write the SES wrapper**

Create `src/lib/email/ses.ts`:
```ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type SendEmailArgs = { to: string[]; subject: string; html: string; text: string };

// Sends via AWS SES. Gracefully no-ops (no throw) when SES_FROM_ADDRESS or AWS
// credentials are absent, so non-prod/test environments don't fail. Throws on a
// real SES API error.
export async function sendEmail(
  args: SendEmailArgs,
): Promise<{ sent: boolean; skipped?: boolean }> {
  const from = process.env.SES_FROM_ADDRESS;
  if (!from || !process.env.AWS_ACCESS_KEY_ID) return { sent: false, skipped: true };
  const client = new SESv2Client({ region: process.env.AWS_REGION });
  await client.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: args.to },
    Content: { Simple: {
      Subject: { Data: args.subject },
      Body: { Html: { Data: args.html }, Text: { Data: args.text } },
    } },
  }));
  return { sent: true };
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npm test -- tests/lib/cron-auth.test.ts tests/lib/ses-skip.test.ts`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email/ses.ts src/lib/cron/auth.ts package.json package-lock.json tests/lib/cron-auth.test.ts tests/lib/ses-skip.test.ts
git commit -m "feat: SES sendEmail (graceful no-op) + cron Bearer auth"
```

---

## Task 4: Weekly digest orchestration

**Files:**
- Create: `src/lib/email/runDigest.ts`
- Test: `tests/db/run-digest.test.ts`

**Interfaces:**
- Consumes: `createServiceSupabase` (`@/lib/supabase/service`); `sendEmail` (`@/lib/email/ses`); `org_alert_counts` RPC (Task 1); `shouldSendDigest`/`buildOrgDigest`/`AlertCounts` (Task 2).
- Produces: `runWeeklyDigest(opts?: { send?: SendFn; client?: ServiceClient }): Promise<DigestSummary>` where `DigestSummary = { orgsProcessed: number; digestsSent: number; skipped: number }`; `SendFn = (a: { to: string[]; subject: string; html: string; text: string }) => Promise<{ sent: boolean; skipped?: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/run-digest.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { runWeeklyDigest } from "@/lib/email/runDigest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const svc = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const ORG_HIT = "11111111-1111-1111-1111-111111111111";   // has signals + active admin
const ORG_ZERO = "22222222-2222-2222-2222-222222222222";  // no signals → skipped
const ORG_NOADMIN = "33333333-3333-3333-3333-333333333333"; // signals but no admin → skipped

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.providers, public.patients, public.staff, public.organizations
             restart identity cascade`);
    await q(`insert into public.organizations (id, name)
             values ($1,'HitOrg'),($2,'ZeroOrg'),($3,'NoAdminOrg')`, [ORG_HIT, ORG_ZERO, ORG_NOADMIN]);
    // HitOrg: a due-this-week patient + an active admin + a deactivated admin + a specialist.
    await q(`insert into public.patients (org_id, name, status, next_due)
             values ($1,'P','verified', current_date + 2)`, [ORG_HIT]);
    await q(`insert into public.staff (org_id, name, email, role, deleted_at) values
             ($1,'Active','active@hit.com','admin', null),
             ($1,'Gone','gone@hit.com','admin', now()),
             ($1,'Spec','spec@hit.com','specialist', null)`, [ORG_HIT]);
    // NoAdminOrg: a signal but only a specialist (no admin recipient).
    await q(`insert into public.patients (org_id, name, status, next_due)
             values ($1,'Q','pending', null)`, [ORG_NOADMIN]);
    await q(`insert into public.staff (org_id, name, email, role) values ($1,'S','s@na.com','specialist')`, [ORG_NOADMIN]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.providers, public.patients, public.staff,
                          public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("runWeeklyDigest", () => {
  it("sends one digest per eligible org to active admins only; skips zero/no-admin orgs", async () => {
    const calls: Array<{ to: string[]; subject: string }> = [];
    const fakeSend = async (a: { to: string[]; subject: string; html: string; text: string }) => {
      calls.push({ to: a.to, subject: a.subject }); return { sent: true };
    };
    const summary = await runWeeklyDigest({ send: fakeSend, client: svc });
    expect(summary.orgsProcessed).toBe(3);
    expect(summary.digestsSent).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toEqual(["active@hit.com"]); // not the deactivated admin, not the specialist
    expect(calls[0].subject).toContain("HitOrg");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/db/run-digest.test.ts`
Expected: FAIL — `Cannot find module '@/lib/email/runDigest'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/email/runDigest.ts`:
```ts
import { createServiceSupabase } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/ses";
import { buildOrgDigest, shouldSendDigest, type AlertCounts } from "@/lib/email/digest";

type SendFn = (a: { to: string[]; subject: string; html: string; text: string }) => Promise<{ sent: boolean; skipped?: boolean }>;
type ServiceClient = ReturnType<typeof createServiceSupabase>;
export type DigestSummary = { orgsProcessed: number; digestsSent: number; skipped: number };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://coverlog.app";

export async function runWeeklyDigest(
  opts: { send?: SendFn; client?: ServiceClient } = {},
): Promise<DigestSummary> {
  const send = opts.send ?? sendEmail;
  const client = opts.client ?? createServiceSupabase();

  const { data: orgs, error } = await client.from("organizations").select("id, name");
  if (error) throw new Error(`runWeeklyDigest failed: ${error.message}`);

  let digestsSent = 0;
  let skipped = 0;
  for (const org of (orgs ?? []) as Array<{ id: string; name: string }>) {
    const { data: countRows, error: cErr } = await client.rpc("org_alert_counts", { p_org_id: org.id });
    if (cErr) throw new Error(`org_alert_counts failed: ${cErr.message}`);
    const r = ((countRows ?? []) as any[])[0] ?? {};
    const counts: AlertCounts = {
      licensesExpiring: Number(r.licenses_expiring ?? 0),
      revalidationsDue: Number(r.revalidations_due ?? 0),
      consentsExpiring: Number(r.consents_expiring ?? 0),
      dueThisWeek: Number(r.due_this_week ?? 0),
      needsAttention: Number(r.needs_attention ?? 0),
    };

    const { data: admins, error: aErr } = await client.from("staff")
      .select("email").eq("org_id", org.id).eq("role", "admin").is("deleted_at", null);
    if (aErr) throw new Error(`runWeeklyDigest admins failed: ${aErr.message}`);
    const to = ((admins ?? []) as Array<{ email: string | null }>)
      .map((a) => a.email).filter((e): e is string => Boolean(e));

    if (!shouldSendDigest(counts) || to.length === 0) { skipped++; continue; }
    const { subject, html, text } = buildOrgDigest(org.name, counts, APP_URL);
    await send({ to, subject, html, text });
    digestsSent++;
  }
  return { orgsProcessed: (orgs ?? []).length, digestsSent, skipped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/db/run-digest.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/runDigest.ts tests/db/run-digest.test.ts
git commit -m "feat: weekly digest orchestration (per-org counts → active admins)"
```

---

## Task 5: Cron routes + vercel.json + env + build gate

**Files:**
- Create: `src/app/api/cron/weekly-digest/route.ts`, `src/app/api/cron/ensure-partitions/route.ts`, `vercel.json`
- Modify: `.env.local.example`
- Test: `tests/lib/cron-routes-smoke.test.ts`

**Interfaces:**
- Consumes: `cronAuthorized` (Task 3), `runWeeklyDigest` (Task 4), `createServiceSupabase`, `ensure_upcoming_access_log_partitions` RPC (Task 1).
- Produces: two guarded `GET` cron routes. No new exported lib API.

- [ ] **Step 1: Write the weekly-digest route**

Create `src/app/api/cron/weekly-digest/route.ts`:
```ts
import { cronAuthorized } from "@/lib/cron/auth";
import { runWeeklyDigest } from "@/lib/email/runDigest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const summary = await runWeeklyDigest();
  return Response.json(summary);
}
```

- [ ] **Step 2: Write the ensure-partitions route**

Create `src/app/api/cron/ensure-partitions/route.ts`:
```ts
import { cronAuthorized } from "@/lib/cron/auth";
import { createServiceSupabase } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const { data, error } = await createServiceSupabase()
    .rpc("ensure_upcoming_access_log_partitions", { p_months: 6 });
  if (error) return new Response(`partition ensure failed: ${error.message}`, { status: 500 });
  return Response.json({ ensured: data });
}
```

- [ ] **Step 3: Add the Vercel cron schedule**

Create `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/weekly-digest", "schedule": "0 13 * * 1" },
    { "path": "/api/cron/ensure-partitions", "schedule": "0 4 1 * *" }
  ]
}
```

- [ ] **Step 4: Document the new env vars**

Append to `.env.local.example`:
```
# Plan 4 — cron + email alerts (all optional in dev; sendEmail no-ops without SES creds)
CRON_SECRET=replace_with_a_long_random_string
SES_FROM_ADDRESS=alerts@example.com
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=replace_with_aws_access_key
AWS_SECRET_ACCESS_KEY=replace_with_aws_secret_key
NEXT_PUBLIC_APP_URL=https://coverlog.app
```

- [ ] **Step 5: Smoke-test the route modules**

Create `tests/lib/cron-routes-smoke.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";

const orig = process.env.CRON_SECRET;
afterEach(() => { process.env.CRON_SECRET = orig; });

describe("cron routes", () => {
  it("weekly-digest GET returns 401 without the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("@/app/api/cron/weekly-digest/route");
    const res = await GET(new Request("https://x/api/cron/weekly-digest"));
    expect(res.status).toBe(401);
  });
  it("ensure-partitions GET returns 401 without the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("@/app/api/cron/ensure-partitions/route");
    const res = await GET(new Request("https://x/api/cron/ensure-partitions"));
    expect(res.status).toBe(401);
  });
});
```
> Asserting the 401 path (not the authorized path) keeps the smoke test from hitting SES or the live DB while still proving the guard is wired into each route.

- [ ] **Step 6: Build gate — smoke + typecheck + build + full suite**

Run:
```bash
npm test -- tests/lib/cron-routes-smoke.test.ts
npx tsc --noEmit
npm run build
npm test
```
Expected: smoke passes (2); `tsc` clean; `next build` completes with `/api/cron/weekly-digest` and `/api/cron/ensure-partitions` routes; full suite green.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/cron" vercel.json .env.local.example tests/lib/cron-routes-smoke.test.ts
git commit -m "feat: Vercel cron routes (weekly digest + partition roll) with CRON_SECRET guard"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** `org_alert_counts` + `ensure_upcoming_access_log_partitions` (Task 1); digest content builder + zero-skip + PHI-minimization (Task 2); SES graceful no-op + cron Bearer auth (Task 3); per-org orchestration → active admins (Task 4); guarded cron routes + `vercel.json` + env + AWS dep (Tasks 3, 5). Both subsystems (digests + partition roll) covered.
- **Deferred (by design):** user-composed email; password-reset/magic-link auth; sent-digest idempotency table (weekly best-effort); per-org error isolation (v1 fail-fast); SMS; Vercel Hobby cron limits (assumes Pro).
- **Type consistency:** `AlertCounts` (Task 2) consumed by `runWeeklyDigest` (Task 4) and asserted in digest tests; `SendFn`/`DigestSummary` (Task 4) used by the digest route (Task 5); `cronAuthorized` (Task 3) used by both routes (Task 5); `org_alert_counts`/`ensure_upcoming_access_log_partitions` (Task 1) consumed by Task 4 and Task 5's partition route. Count field names map `licenses_expiring`→`licensesExpiring` etc. consistently.
- **Security:** SECURITY DEFINER stat/partition functions have execute revoked from anon/authenticated and granted to service_role only (Task 1); service role used only on the cron paths (Tasks 4–5); cron routes fail closed without `CRON_SECRET` (Task 3); no PHI in email bodies (Task 2). No `disclosure_log` write (digests aren't a Part 2 disclosure).
- **Migration numbering:** continues `0013`; `db:reset` rebuilds cleanly.

---

## Subsequent Plans / Follow-ups
- Per-org error isolation + a sent-digest audit/idempotency table for the digest run.
- Password-reset / magic-link auth; staff invitation (auth-user creation + invite/link).
- Compliance review items: pgaudit coverage for `service_role`/admin sessions (cron paths now use service role); confirm SES + Vercel + Supabase BAAs before real PHI.
