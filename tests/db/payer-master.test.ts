import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let masterId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_claim_rules,
             public.payer_directory, public.payer_master, public.staff, public.organizations
             restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    const m = await q(`insert into public.payer_master (name, payer_type)
                       values ('Aetna','commercial') returning id`);
    masterId = m.rows[0].id;
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_master restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("payer_master", () => {
  it("authenticated tenants can read the master list", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select name from public.payer_master`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["Aetna"]);
  });

  it("authenticated tenants CANNOT insert a master payer (curation-only)", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`insert into public.payer_master (name) values ('Rogue')`)),
    ).rejects.toThrow(/row-level security|permission/i);
  });

  it("coverage rows now key on payer_master_id", async () => {
    await withClaims(USER_A, async (q) =>
      q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, source)
         values (public.user_org_id(), $1, '90837', 'org')`, [masterId]));
    const rows = await asAdmin(async (q) =>
      (await q(`select cpt_code from public.payer_code_coverage where payer_master_id=$1`, [masterId])).rows);
    expect(rows.map((r: any) => r.cpt_code)).toEqual(["90837"]);
  });
});
