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

export type MasterPayer = { id: string; name: string; payer_type: string | null };
export type BaselineCoverageRow = {
  id: string; cpt_code: string; covered: boolean; requires_prior_auth: boolean;
  telehealth_allowed: boolean | null; modifier_required: string | null;
  unit_limit: string | null; notes: string | null; verified_by: string | null;
};
export type BaselineClaimRuleRow = {
  id: string; rule_category: string | null; field_reference: string | null;
  rule_description: string | null; required_value: string | null; notes: string | null;
  verified_by: string | null;
};

export async function listMasterPayers(svc: Pick<SupabaseClient, "from">): Promise<MasterPayer[]> {
  const { data, error } = await svc.from("payer_master")
    .select("id, name, payer_type").order("name");
  if (error) throw new Error(`listMasterPayers failed: ${error.message}`);
  return (data ?? []) as MasterPayer[];
}

export async function listBaselineCoverage(
  svc: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<BaselineCoverageRow[]> {
  const { data, error } = await svc.from("payer_code_coverage")
    .select("id, cpt_code, covered, requires_prior_auth, telehealth_allowed, modifier_required, unit_limit, notes, verified_by")
    .eq("payer_master_id", payerMasterId).is("org_id", null).order("cpt_code");
  if (error) throw new Error(`listBaselineCoverage failed: ${error.message}`);
  return (data ?? []) as BaselineCoverageRow[];
}

export async function listBaselineClaimRules(
  svc: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<BaselineClaimRuleRow[]> {
  const { data, error } = await svc.from("payer_claim_rules")
    .select("id, rule_category, field_reference, rule_description, required_value, notes, verified_by")
    .eq("payer_master_id", payerMasterId).is("org_id", null).order("rule_category");
  if (error) throw new Error(`listBaselineClaimRules failed: ${error.message}`);
  return (data ?? []) as BaselineClaimRuleRow[];
}
