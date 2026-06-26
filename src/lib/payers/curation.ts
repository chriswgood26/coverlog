import type { SupabaseClient } from "@supabase/supabase-js";

export type BaselineCoverageInput = {
  payerMasterId: string; cptCode: string; covered: boolean;
  requiresPriorAuth?: boolean; modifierRequired?: string;
  telehealthAllowed?: boolean; unitLimit?: string; notes?: string; verifiedBy?: string;
};
export type BaselineClaimRuleInput = {
  payerMasterId: string; ruleCategory: string; fieldReference?: string;
  ruleDescription?: string; requiredValue?: string; notes?: string; verifiedBy?: string;
};

export async function upsertMasterPayer(
  svc: Pick<SupabaseClient, "from">, input: { name: string; payerType?: string },
): Promise<{ id: string }> {
  const { data, error } = await svc.from("payer_master")
    .upsert({ name: input.name, payer_type: input.payerType ?? null }, { onConflict: "name" })
    .select("id").single();
  if (error) throw new Error(`upsertMasterPayer failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

export async function upsertBaselineCoverage(
  svc: Pick<SupabaseClient, "from">, input: BaselineCoverageInput,
): Promise<void> {
  const { error } = await svc.from("payer_code_coverage").upsert({
    org_id: null, payer_master_id: input.payerMasterId, cpt_code: input.cptCode,
    covered: input.covered, requires_prior_auth: input.requiresPriorAuth ?? false,
    modifier_required: input.modifierRequired ?? null, telehealth_allowed: input.telehealthAllowed ?? null,
    unit_limit: input.unitLimit ?? null, notes: input.notes ?? null,
    source: "coverlog_baseline", verified_at: new Date().toISOString(), verified_by: input.verifiedBy ?? null,
  }, { onConflict: "payer_master_id,cpt_code,org_id" });
  if (error) throw new Error(`upsertBaselineCoverage failed: ${error.message}`);
}

export async function upsertBaselineClaimRule(
  svc: Pick<SupabaseClient, "from">, input: BaselineClaimRuleInput,
): Promise<void> {
  const { error } = await svc.from("payer_claim_rules").upsert({
    org_id: null, payer_master_id: input.payerMasterId, rule_category: input.ruleCategory,
    field_reference: input.fieldReference ?? null, rule_description: input.ruleDescription ?? null,
    required_value: input.requiredValue ?? null, notes: input.notes ?? null,
    source: "coverlog_baseline", verified_at: new Date().toISOString(), verified_by: input.verifiedBy ?? null,
  }, { onConflict: "payer_master_id,rule_category,field_reference,org_id" });
  if (error) throw new Error(`upsertBaselineClaimRule failed: ${error.message}`);
}
