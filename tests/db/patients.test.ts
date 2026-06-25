import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.eligibility_checks, public.patients, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Org A'),($2,'Org B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Alice','a@a.com','admin'),($3,$4,'Bob','b@b.com','admin')`,
            [ORG_A, USER_A, ORG_B, USER_B]);
    await q(`insert into public.patients (org_id, name) values ($1,'Pat A'),($2,'Pat B')`, [ORG_A, ORG_B]);
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("patients isolation", () => {
  it("user A reads only org A patients", async () => {
    const rows = await withClaims(USER_A, async (q) => (await q(`select name from public.patients`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["Pat A"]);
  });

  it("user A cannot insert a patient into org B", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`insert into public.patients (org_id, name) values ($1,'Sneaky')`, [ORG_B]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
