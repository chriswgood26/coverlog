import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    // Seed a September row for each org directly into the partitioned parent.
    await q(`insert into public.access_log (org_id, action, occurred_at)
             values ($1,'list_view','2026-09-15'),($2,'list_view','2026-09-15')`, [ORG_A, ORG_B]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.access_log restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("access_log future partitions", () => {
  it("partition for 2026-09 exists with forced RLS", async () => {
    const rows = await asAdmin(async (q) => (await q(
      `select relforcerowsecurity from pg_class where relname = 'access_log_2026_09'`)).rows);
    expect(rows.length).toBe(1);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it("tenant reading the 2026-09 child directly sees only their org", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select org_id from public.access_log_2026_09`)).rows);
    expect(rows.map((r: any) => r.org_id)).toEqual([ORG_A]);
  });

  it("tenant cannot UPDATE the 2026-09 child (append-only)", async () => {
    await expect(
      withClaims(USER_A, async (q) => q(`update public.access_log_2026_09 set action='x'`)),
    ).rejects.toThrow(/append-only|permission/i);
  });

  it("ensure_access_log_partition is idempotent", async () => {
    await expect(
      asAdmin((q) => q(`select public.ensure_access_log_partition('2026-09-01')`)),
    ).resolves.toBeDefined();
  });

  it("far-future partition 2028-01 exists with forced RLS", async () => {
    const rows = await asAdmin(async (q) => (await q(
      `select relforcerowsecurity from pg_class where relname = 'access_log_2028_01'`)).rows);
    expect(rows.length).toBe(1);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });
});
