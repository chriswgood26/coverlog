import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let payerDirId: string;
let patientId: string;
let providerId: string;

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.patients,
             public.payer_directory, public.staff, public.organizations
             restart identity cascade`);

    // ── ORG_A ───────────────────────────────────────────────────────────────
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name)
                        values ($1,'Aetna') returning id`, [ORG_A]);
    payerDirId = pd.rows[0].id;
    const pt = await q(`insert into public.patients (org_id, name) values ($1,'Pat') returning id`, [ORG_A]);
    patientId = pt.rows[0].id;

    // Dr A: license expires in 30 days → within 60-day window → COUNTED.
    const pr = await q(`insert into public.providers (org_id, name, license_expiration)
                        values ($1,'Dr A', current_date + 30) returning id`, [ORG_A]);
    providerId = pr.rows[0].id;

    // Dr B: license expires in 90 days → outside 60-day window → NOT counted.
    const prB = await q(`insert into public.providers (org_id, name, license_expiration)
                         values ($1,'Dr B', current_date + 90) returning id`, [ORG_A]);
    const drBId: string = prB.rows[0].id;

    // Dr C: license already overdue (-10d) — still satisfies <= current_date+60 → COUNTED.
    await q(`insert into public.providers (org_id, name, license_expiration)
             values ($1,'Dr C', current_date - 10)`, [ORG_A]);

    // Enrollment (Dr A, enrolled, +10d) → within window and active → COUNTED.
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 10)`, [ORG_A, providerId, payerDirId]);

    // Enrollment (Dr B, terminated, +5d) → within window but status='terminated' → NOT counted.
    // (Uses Dr B to avoid unique-index collision on (org_id, provider_id, payer_id).)
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'terminated', current_date + 5)`, [ORG_A, drBId, payerDirId]);

    // ── ORG_B — no staff row; USER_A must NOT see these rows (RLS isolation) ──
    await q(`insert into public.organizations (id, name) values ($1,'B')`, [ORG_B]);
    const pdB = await q(`insert into public.payer_directory (org_id, payer_name)
                         values ($1,'BlueCross') returning id`, [ORG_B]);
    const payerDirIdB: string = pdB.rows[0].id;
    const prOrgB = await q(`insert into public.providers (org_id, name, license_expiration)
                            values ($1,'Dr B-Org2', current_date + 20) returning id`, [ORG_B]);
    const providerIdB: string = prOrgB.rows[0].id;
    // ORG_B enrollment due in 10 days — invisible to USER_A via RLS → must NOT inflate counts.
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 10)`, [ORG_B, providerIdB, payerDirIdB]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers,
                          public.patients, public.payer_directory restart identity cascade`));
  // resetDb() truncates staff + organizations (cascade) — covers both ORG_A and ORG_B.
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
    // licenses_expiring = 2:
    //   Dr A (+30d) COUNTED; Dr C (overdue, -10d) COUNTED (overdue still satisfies <= current_date+60);
    //   Dr B (+90d) excluded (outside window); ORG_B's provider (+20d) excluded by RLS.
    expect(Number(rows[0].licenses_expiring)).toBe(2);
    // revalidations_due = 1:
    //   Dr A's +10d enrolled enrollment COUNTED;
    //   Dr B's terminated +5d enrollment excluded (status = 'terminated');
    //   ORG_B's +10d enrollment excluded by RLS.
    expect(Number(rows[0].revalidations_due)).toBe(1);
  });
});
