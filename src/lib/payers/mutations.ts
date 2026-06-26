import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

export type OrgCoverageInput = {
  payerMasterId: string;
  cptCode: string;
  covered: boolean;
  requiresPriorAuth?: boolean;
  modifierRequired?: string;
  telehealthAllowed?: boolean;
  unitLimit?: string;
  notes?: string;
};

export type OrgClaimRuleInput = {
  payerMasterId: string;
  ruleCategory: string;
  fieldReference?: string;
  ruleDescription?: string;
  requiredValue?: string;
  notes?: string;
};

export async function upsertOrgCoverage(
  client: Pick<SupabaseClient, "from">,
  ctx: StaffContext,
  input: OrgCoverageInput,
): Promise<void> {
  const { error } = await client.from("payer_code_coverage").upsert(
    {
      org_id: ctx.orgId,
      payer_master_id: input.payerMasterId,
      cpt_code: input.cptCode,
      covered: input.covered,
      requires_prior_auth: input.requiresPriorAuth ?? false,
      modifier_required: input.modifierRequired ?? null,
      telehealth_allowed: input.telehealthAllowed ?? null,
      unit_limit: input.unitLimit ?? null,
      notes: input.notes ?? null,
      source: "org",
    },
    { onConflict: "org_id,payer_master_id,cpt_code" },
  );
  if (error) throw new Error(`upsertOrgCoverage failed: ${error.message}`);
}

export async function upsertOrgClaimRule(
  client: Pick<SupabaseClient, "from">,
  ctx: StaffContext,
  input: OrgClaimRuleInput,
): Promise<void> {
  const { error } = await client.from("payer_claim_rules").upsert(
    {
      org_id: ctx.orgId,
      payer_master_id: input.payerMasterId,
      rule_category: input.ruleCategory,
      field_reference: input.fieldReference ?? null,
      rule_description: input.ruleDescription ?? null,
      required_value: input.requiredValue ?? null,
      notes: input.notes ?? null,
      source: "org",
    },
    { onConflict: "org_id,payer_master_id,rule_category,field_reference" },
  );
  if (error) throw new Error(`upsertOrgClaimRule failed: ${error.message}`);
}

export async function linkPayerToMaster(
  client: Pick<SupabaseClient, "from">,
  ctx: StaffContext,
  payerDirectoryId: string,
  payerMasterId: string,
): Promise<void> {
  const { error } = await client
    .from("payer_directory")
    .update({ payer_master_id: payerMasterId })
    .eq("id", payerDirectoryId)
    .eq("org_id", ctx.orgId);
  if (error) throw new Error(`linkPayerToMaster failed: ${error.message}`);
}
