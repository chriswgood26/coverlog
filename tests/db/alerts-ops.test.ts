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
    const pd2 = await q(`insert into public.payer_directory (org_id, payer_name) values ($1,'BlueCross') returning id`, [ORG_A]);
    const pr = await q(`insert into public.providers (org_id, name) values ($1,'DrEnr') returning id`, [ORG_A]);
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 10),
                    ($1,$2,$4,'terminated', current_date + 5)`, [ORG_A, pr.rows[0].id, pd.rows[0].id, pd2.rows[0].id]);
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
    await asAdmin((q) => q(`drop table if exists public.${tbl}`));
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
    await asAdmin((q) => q(`drop table if exists public.${tbl}`));
  });
});
