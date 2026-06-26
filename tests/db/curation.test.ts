import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { asAdmin, pool, resetDb } from "./helpers";
import { createServiceSupabase } from "@/lib/supabase/service";
import { upsertMasterPayer, upsertBaselineCoverage } from "@/lib/payers/curation";

const svc = createServiceSupabase();

beforeAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_master
                          restart identity cascade`));
});
afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_master
                          restart identity cascade`));
  await resetDb(); await pool.end();
});

describe("curation (service role)", () => {
  it("creates a master payer and a baseline coverage row (org_id null)", async () => {
    const { id } = await upsertMasterPayer(svc, { name: "Cigna", payerType: "commercial" });
    expect(id).toBeTruthy();
    await upsertBaselineCoverage(svc, { payerMasterId: id, cptCode: "90834", covered: true, requiresPriorAuth: false });
    const rows = await asAdmin(async (q) =>
      (await q(`select org_id, source, cpt_code from public.payer_code_coverage where payer_master_id=$1`, [id])).rows);
    expect(rows[0]).toMatchObject({ org_id: null, source: "coverlog_baseline", cpt_code: "90834" });
  });

  it("re-curating the same code UPDATES the baseline row (NULLS NOT DISTINCT dedup), not duplicates it", async () => {
    const { id } = await upsertMasterPayer(svc, { name: "Humana" });
    await upsertBaselineCoverage(svc, { payerMasterId: id, cptCode: "90837", covered: true });
    await upsertBaselineCoverage(svc, { payerMasterId: id, cptCode: "90837", covered: false }); // re-curate
    const rows = await asAdmin(async (q) =>
      (await q(`select covered from public.payer_code_coverage where payer_master_id=$1 and cpt_code='90837'`, [id])).rows);
    expect(rows).toHaveLength(1);          // updated in place, not duplicated
    expect(rows[0].covered).toBe(false);   // reflects the second curation
  });
});
