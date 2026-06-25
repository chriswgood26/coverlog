import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let payerId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Org A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Alice','a@a.com','admin')`, [ORG_A, USER_A]);
    const p = await q(`insert into public.payer_directory (org_id, payer_name)
                       values ($1,'Aetna') returning id`, [ORG_A]);
    payerId = p.rows[0].id;
    // One baseline row (org_id null) + one org-specific override for same code.
    await q(`insert into public.payer_code_coverage (org_id, payer_id, cpt_code, covered, source)
             values (null, $1, '90837', true, 'coverlog_baseline')`, [payerId]);
    await q(`insert into public.payer_code_coverage (org_id, payer_id, cpt_code, covered, source)
             values ($1, $2, '90837', false, 'org')`, [ORG_A, payerId]);
  });
});

afterAll(async () => {
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
        q(`insert into public.payer_code_coverage (org_id, payer_id, cpt_code, source)
           values (null, $1, '99999', 'coverlog_baseline')`, [payerId]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
