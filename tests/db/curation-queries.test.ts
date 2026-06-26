import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { asAdmin, pool, resetDb } from "./helpers";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  upsertMasterPayer, upsertBaselineCoverage, upsertBaselineClaimRule,
  listMasterPayers, listBaselineCoverage, listBaselineClaimRules,
} from "@/lib/payers/curation";

const svc = createServiceSupabase();
const ORG = "33333333-3333-3333-3333-333333333333";
let aetnaId: string;

beforeAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_claim_rules, public.payer_master, public.organizations restart identity cascade`));
  await asAdmin((q) => q(`insert into public.organizations (id, name) values ($1,'Override Org')`, [ORG]));
  await upsertMasterPayer(svc, { name: "Cigna" });
  aetnaId = (await upsertMasterPayer(svc, { name: "Aetna", payerType: "commercial" })).id;
  await upsertBaselineCoverage(svc, { payerMasterId: aetnaId, cptCode: "90834", covered: true });
  await upsertBaselineCoverage(svc, { payerMasterId: aetnaId, cptCode: "90837", covered: false, requiresPriorAuth: true });
  await upsertBaselineClaimRule(svc, { payerMasterId: aetnaId, ruleCategory: "timely_filing", requiredValue: "90 days" });
  // org-scoped OVERRIDE for the same payer+CPT — must be excluded from baseline lists
  await asAdmin((q) => q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, source) values ($1,$2,'90834','org')`, [ORG, aetnaId]));
  // org-scoped claim-rule override for the same payer+category — must be excluded from baseline claim-rule list
  await asAdmin((q) => q(`insert into public.payer_claim_rules (org_id, payer_master_id, rule_category, source) values ($1,$2,'timely_filing','org')`, [ORG, aetnaId]));
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.payer_code_coverage, public.payer_claim_rules, public.payer_master, public.organizations restart identity cascade`));
  await resetDb(); await pool.end();
});

describe("curation queries (service role)", () => {
  it("listMasterPayers returns all payers ordered by name", async () => {
    const names = (await listMasterPayers(svc)).map((p) => p.name);
    expect(names).toEqual(["Aetna", "Cigna"]);
  });

  it("listBaselineCoverage returns only baseline (org_id null) rows, excluding org overrides", async () => {
    const rows = await listBaselineCoverage(svc, aetnaId);
    expect(rows.map((r) => r.cpt_code)).toEqual(["90834", "90837"]); // ordered; the org override of 90834 is excluded
    expect(rows).toHaveLength(2);
    const r37 = rows.find((r) => r.cpt_code === "90837")!;
    expect(r37.covered).toBe(false);
    expect(r37.requires_prior_auth).toBe(true);
  });

  it("listBaselineClaimRules returns the baseline rules", async () => {
    // table has a baseline + an org override for timely_filing; baseline list must exclude the org one
    const rules = await listBaselineClaimRules(svc, aetnaId);
    expect(rules).toHaveLength(1); // proves exclusion: 2 timely_filing rows exist but only 1 baseline returned
    expect(rules[0]).toMatchObject({ rule_category: "timely_filing", required_value: "90 days" });
  });
});
