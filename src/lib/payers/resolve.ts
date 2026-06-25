import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolvedCoverage = {
  cpt_code: string; covered: boolean; requires_prior_auth: boolean;
  modifier_required: string | null; telehealth_allowed: boolean | null;
  unit_limit: string | null; notes: string | null;
  provenance: "org" | "coverlog_baseline";
};
export type ResolvedClaimRule = {
  rule_category: string | null; field_reference: string | null;
  rule_description: string | null; required_value: string | null;
  notes: string | null; provenance: "org" | "coverlog_baseline";
};

// Merge baseline (org_id null) + org rows; the org row wins per key. The RLS-bound
// client already returns only baseline + this org's rows, so org_id non-null = "org".
function mergeByKey<T extends { org_id: string | null }>(
  rows: T[], keyOf: (r: T) => string,
): Array<T & { provenance: "org" | "coverlog_baseline" }> {
  const byKey = new Map<string, T & { provenance: "org" | "coverlog_baseline" }>();
  for (const r of rows) {
    const key = keyOf(r);
    const tagged = { ...r, provenance: (r.org_id ? "org" : "coverlog_baseline") as "org" | "coverlog_baseline" };
    const existing = byKey.get(key);
    // Org row (org_id non-null) always wins over a baseline row for the same key.
    if (!existing || (tagged.provenance === "org" && existing.provenance === "coverlog_baseline")) {
      byKey.set(key, tagged);
    }
  }
  return [...byKey.values()];
}

export async function resolveCoverage(
  client: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<ResolvedCoverage[]> {
  const { data, error } = await client
    .from("payer_code_coverage").select("*").eq("payer_master_id", payerMasterId);
  if (error) throw new Error(`resolveCoverage failed: ${error.message}`);
  const merged = mergeByKey(data ?? [], (r: any) => r.cpt_code);
  return merged.map((r: any) => ({
    cpt_code: r.cpt_code, covered: r.covered, requires_prior_auth: r.requires_prior_auth,
    modifier_required: r.modifier_required, telehealth_allowed: r.telehealth_allowed,
    unit_limit: r.unit_limit, notes: r.notes, provenance: r.provenance,
  })).sort((a, b) => a.cpt_code.localeCompare(b.cpt_code));
}

export async function resolveClaimRules(
  client: Pick<SupabaseClient, "from">, payerMasterId: string,
): Promise<ResolvedClaimRule[]> {
  const { data, error } = await client
    .from("payer_claim_rules").select("*").eq("payer_master_id", payerMasterId);
  if (error) throw new Error(`resolveClaimRules failed: ${error.message}`);
  const merged = mergeByKey(data ?? [], (r: any) => `${r.rule_category}|${r.field_reference}`);
  return merged.map((r: any) => ({
    rule_category: r.rule_category, field_reference: r.field_reference,
    rule_description: r.rule_description, required_value: r.required_value,
    notes: r.notes, provenance: r.provenance,
  }));
}
