import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let payerDirId: string;
let patientId: string;
let providerId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.patients,
             public.payer_directory, public.staff, public.organizations
             restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name)
                        values ($1,'Aetna') returning id`, [ORG_A]);
    payerDirId = pd.rows[0].id;
    const pt = await q(`insert into public.patients (org_id, name) values ($1,'Pat') returning id`, [ORG_A]);
    patientId = pt.rows[0].id;
    const pr = await q(`insert into public.providers (org_id, name, license_expiration)
                        values ($1,'Dr A', current_date + 30) returning id`, [ORG_A]);
    providerId = pr.rows[0].id;
    // Second provider's license is far out (90 days) → NOT counted in the 60-day window.
    await q(`insert into public.providers (org_id, name, license_expiration)
             values ($1,'Dr B', current_date + 90)`, [ORG_A]);
    // Enrollment due for revalidation in 10 days → counted.
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 10)`, [ORG_A, providerId, payerDirId]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers,
                          public.patients, public.payer_directory restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("credentialing schema", () => {
  it("links a patient to a payer_directory row via primary_payer_directory_id", async () => {
    await withClaims(USER_A, async (q) =>
      q(`update public.patients set primary_payer_directory_id=$1 where id=$2`, [payerDirId, patientId]));
    const rows = await asAdmin(async (q) =>
      (await q(`select primary_payer_directory_id from public.patients where id=$1`, [patientId])).rows);
    expect(rows[0].primary_payer_directory_id).toBe(payerDirId);
  });

  it("credentialing_stats counts only items inside the 60-day window, RLS-scoped", async () => {
    const rows = await withClaims(USER_A, async (q) =>
      (await q(`select * from public.credentialing_stats()`)).rows);
    expect(Number(rows[0].licenses_expiring)).toBe(1);   // Dr A (30d) yes, Dr B (90d) no
    expect(Number(rows[0].revalidations_due)).toBe(1);   // the 10-day enrollment
  });
});
