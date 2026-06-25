import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "22222222-2222-2222-2222-222222222222";
let patientId: string;
let orgBPatientId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.eligibility_checks, public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    const p = await q(`insert into public.patients (org_id, name, status) values ($1,'Jane','pending') returning id`, [ORG_A]);
    patientId = p.rows[0].id;
    await q(`insert into public.organizations (id, name) values ($1,'B')`, [ORG_B]);
    const pb = await q(`insert into public.patients (org_id, name, status) values ($1,'Bob','pending') returning id`, [ORG_B]);
    orgBPatientId = pb.rows[0].id;
  });
});

afterAll(async () => { await resetDb(); await pool.end(); });

describe("log_eligibility_check", () => {
  it("inserts a check AND updates the parent patient atomically", async () => {
    await withClaims(USER_A, async (q) => {
      await q(`select public.log_eligibility_check($1,'Aetna','verified',25,500,'ok',$2)`,
        [patientId, "2026-09-01"]);
    });
    const { patient, checks } = await asAdmin(async (q) => ({
      patient: (await q(`select status, last_checked, next_due, primary_payer from public.patients where id=$1`, [patientId])).rows[0],
      checks: (await q(`select status, copay, payer from public.eligibility_checks where patient_id=$1`, [patientId])).rows,
    }));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ status: "verified", payer: "Aetna" });
    expect(patient).toMatchObject({ status: "verified", primary_payer: "Aetna" });
    expect(patient.next_due.toISOString().slice(0, 10)).toBe("2026-09-01");
    const today = new Date().toISOString().slice(0, 10);
    expect(patient.last_checked.toISOString().slice(0, 10)).toBe(today);
  });

  it("rejects a cross-org patient_id and writes no orphan check row", async () => {
    await expect(
      withClaims(USER_A, async (q) => {
        await q(`select public.log_eligibility_check($1,'Cigna','verified',10,100,'x',$2)`,
          [orgBPatientId, "2026-12-01"]);
      }),
    ).rejects.toThrow(/not found/i);

    const orphans = await asAdmin(async (q) =>
      (await q(`select id from public.eligibility_checks where patient_id=$1`, [orgBPatientId])).rows,
    );
    expect(orphans).toHaveLength(0);
  });
});
