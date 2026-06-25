// audit-lockdown.test.ts — Regression tests for C1, C2, C3 security fixes.
//
// These tests FAIL against pre-fix code (before 0006_audit_lockdown.sql):
//   C1: Cross-tenant read via partition child (direct SELECT on access_log_2026_06)
//   C2: TRUNCATE denied on access_log by `authenticated`
//   C3: UPDATE/DELETE on partition child blocked (trigger + no policy)
//
// After the fix, all assertions should PASS.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-000000000002";

// A fixed timestamp that falls in June 2026 (routes into access_log_2026_06).
const JUNE_TS = "2026-06-15 12:00:00+00";
// A fixed timestamp that falls in July 2026 (routes into access_log_2026_07).
const JULY_TS = "2026-07-15 12:00:00+00";

beforeAll(async () => {
  await asAdmin(async (q) => {
    // Full wipe of all tenant tables to start from a known-clean state.
    await q(`truncate table
      public.access_log,
      public.disclosure_log,
      public.patient_consents,
      public.patients,
      public.staff,
      public.organizations
      restart identity cascade`);

    // Seed two orgs and one staff user per org.
    await q(
      `insert into public.organizations (id, name) values ($1,'Org A'),($2,'Org B')`,
      [ORG_A, ORG_B],
    );
    await q(
      `insert into public.staff (org_id, user_id, name, email, role)
       values ($1,$2,'Alice','a@a.com','admin'),
              ($3,$4,'Bob','b@b.com','admin')`,
      [ORG_A, USER_A, ORG_B, USER_B],
    );

    // Seed one access_log row per org in June 2026 (goes into access_log_2026_06).
    await q(
      `insert into public.access_log (org_id, action, occurred_at)
       values ($1,'orgA_june_action',$3),
              ($2,'orgB_june_action',$3)`,
      [ORG_A, ORG_B, JUNE_TS],
    );

    // Seed one access_log row per org in July 2026 (goes into access_log_2026_07).
    await q(
      `insert into public.access_log (org_id, action, occurred_at)
       values ($1,'orgA_july_action',$3),
              ($2,'orgB_july_action',$3)`,
      [ORG_A, ORG_B, JULY_TS],
    );
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

// ── C1: Cross-tenant read via partition child ──────────────────────────────
describe("C1 — partition child RLS isolation", () => {
  it("user A querying access_log_2026_06 directly sees ONLY org A rows (not org B)", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select action from public.access_log_2026_06 order by action`)).rows,
    );
    const actions = rows.map((r: any) => r.action);
    expect(actions).toContain("orgA_june_action");
    expect(actions).not.toContain("orgB_june_action");
  });

  it("user B querying access_log_2026_06 directly sees ONLY org B rows (not org A)", async () => {
    const rows = await withClaims(USER_B, async (q) =>
      (await q(`select action from public.access_log_2026_06 order by action`)).rows,
    );
    const actions = rows.map((r: any) => r.action);
    expect(actions).toContain("orgB_june_action");
    expect(actions).not.toContain("orgA_june_action");
  });

  it("user A querying access_log_2026_07 directly sees ONLY org A rows", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select action from public.access_log_2026_07 order by action`)).rows,
    );
    const actions = rows.map((r: any) => r.action);
    expect(actions).toContain("orgA_july_action");
    expect(actions).not.toContain("orgB_july_action");
  });
});

// ── C2: TRUNCATE denied on audit tables ───────────────────────────────────
describe("C2 — TRUNCATE on audit tables denied for authenticated", () => {
  it("authenticated user cannot TRUNCATE access_log", async () => {
    await expect(
      withClaims(USER_A, async (q) => q(`truncate public.access_log`)),
    ).rejects.toThrow(/permission denied|must be owner|privilege/i);
  });

  it("authenticated user cannot TRUNCATE disclosure_log", async () => {
    await expect(
      withClaims(USER_A, async (q) => q(`truncate public.disclosure_log`)),
    ).rejects.toThrow(/permission denied|must be owner|privilege/i);
  });

  it("authenticated user cannot TRUNCATE access_log_2026_06 (partition child)", async () => {
    await expect(
      withClaims(USER_A, async (q) => q(`truncate public.access_log_2026_06`)),
    ).rejects.toThrow(/permission denied|must be owner|privilege/i);
  });
});

// ── C3: UPDATE/DELETE on partition child blocked ──────────────────────────
describe("C3 — append-only enforcement on partition children (direct DML)", () => {
  it("UPDATE on access_log_2026_06 directly raises an error (trigger or permission)", async () => {
    // After the fix: either the trigger fires (raises 'append-only' error) or the
    // revoked UPDATE privilege causes a permission-denied error. Both are acceptable.
    await expect(
      withClaims(USER_A, async (q) =>
        q(
          `update public.access_log_2026_06 set action='tampered'
           where org_id = $1`,
          [ORG_A],
        ),
      ),
    ).rejects.toThrow(/append-only|permission denied|privilege/i);
  });

  it("DELETE on access_log_2026_06 directly raises an error (trigger or permission)", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`delete from public.access_log_2026_06 where org_id = $1`, [ORG_A]),
      ),
    ).rejects.toThrow(/append-only|permission denied|privilege/i);
  });

  it("UPDATE on access_log_2026_07 directly raises an error (trigger or permission)", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(
          `update public.access_log_2026_07 set action='tampered'
           where org_id = $1`,
          [ORG_A],
        ),
      ),
    ).rejects.toThrow(/append-only|permission denied|privilege/i);
  });

  it("the org A row in access_log_2026_06 is unchanged after attempted mutations", async () => {
    const rows = await asAdmin(async (q) =>
      (
        await q(
          `select action from public.access_log_2026_06 where org_id = $1`,
          [ORG_A],
        )
      ).rows,
    );
    expect(rows.map((r: any) => r.action)).toEqual(["orgA_june_action"]);
  });
});
