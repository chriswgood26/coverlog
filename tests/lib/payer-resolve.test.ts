import { describe, it, expect } from "vitest";
import { resolveCoverage, resolveClaimRules } from "@/lib/payers/resolve";

function client(rows: any[]) {
  return { from: () => ({ select() { return this; }, eq() { return this; },
    then(r: any) { r({ data: rows, error: null }); } }) } as any;
}

describe("resolveCoverage merge (unit)", () => {
  it("org row wins over baseline for the same cpt_code regardless of row order", async () => {
    const rows = [
      { org_id: "o1", payer_master_id: "m1", cpt_code: "90837", covered: false, requires_prior_auth: false, modifier_required: null, telehealth_allowed: null, unit_limit: null, notes: null },
      { org_id: null, payer_master_id: "m1", cpt_code: "90837", covered: true, requires_prior_auth: true, modifier_required: "HE", telehealth_allowed: true, unit_limit: null, notes: null },
    ];
    const out = await resolveCoverage(client(rows), "m1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cpt_code: "90837", covered: false, provenance: "org" });
  });

  it("org row wins even when the baseline row comes FIRST in the input", async () => {
    const rows = [
      { org_id: null, payer_master_id: "m1", cpt_code: "90837", covered: true, requires_prior_auth: true, modifier_required: "HE", telehealth_allowed: true, unit_limit: null, notes: null },
      { org_id: "o1", payer_master_id: "m1", cpt_code: "90837", covered: false, requires_prior_auth: false, modifier_required: null, telehealth_allowed: null, unit_limit: null, notes: null },
    ];
    const out = await resolveCoverage(client(rows), "m1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cpt_code: "90837", covered: false, provenance: "org" });
  });
});

describe("resolveClaimRules merge (unit)", () => {
  it("org row wins over baseline for the same (rule_category, field_reference)", async () => {
    const rows = [
      { org_id: null, payer_master_id: "m1", rule_category: "billing", field_reference: "box31", rule_description: "baseline desc", required_value: "BASE", notes: "baseline note" },
      { org_id: "o1", payer_master_id: "m1", rule_category: "billing", field_reference: "box31", rule_description: "org desc", required_value: "ORG", notes: "org note" },
    ];
    const out = await resolveClaimRules(client(rows), "m1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rule_category: "billing", field_reference: "box31",
      rule_description: "org desc", required_value: "ORG", notes: "org note",
      provenance: "org",
    });
  });
});
