import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let payerMasterId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_directory,
             public.payer_master, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Org A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Alice','a@a.com','admin')`, [ORG_A, USER_A]);
    // payer_master is curation/service-role-written; asAdmin bypasses RLS to seed it.
    const p = await q(`insert into public.payer_master (name)
                       values ('Aetna') returning id`);
    payerMasterId = p.rows[0].id;
    // One baseline row (org_id null) + one org-specific override for same code.
    await q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, covered, source)
             values (null, $1, '90837', true, 'coverlog_baseline')`, [payerMasterId]);
    await q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, covered, source)
             values ($1, $2, '90837', false, 'org')`, [ORG_A, payerMasterId]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_master restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("hybrid coverage visibility", () => {
  it("user A sees both baseline and own override rows", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select source from public.payer_code_coverage order by source`)).rows);
    expect(rows.map((r: any) => r.source)).toEqual(["coverlog_baseline", "org"]);
  });

  it("user A cannot write a baseline (org_id null) row", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, source)
           values (null, $1, '99999', 'coverlog_baseline')`, [payerMasterId]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
