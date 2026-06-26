import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

export type ProviderInput = {
  name?: string; npi?: string; licenseType?: string;
  licenseNumber?: string; licenseState?: string; licenseExpiration?: string;
};
export type EnrollmentInput = {
  providerId: string; payerDirectoryId: string;
  status: "enrolled" | "pending" | "terminated" | "not_enrolled";
  parStatus?: "in_network" | "out_of_network";
  effectiveDate?: string; terminationDate?: string; revalidationDue?: string;
  caqhId?: string; notes?: string;
};

// Map a partial ProviderInput to DB columns, omitting undefined keys so update
// only touches provided fields.
function providerColumns(input: ProviderInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.npi !== undefined) out.npi = input.npi;
  if (input.licenseType !== undefined) out.license_type = input.licenseType;
  if (input.licenseNumber !== undefined) out.license_number = input.licenseNumber;
  if (input.licenseState !== undefined) out.license_state = input.licenseState;
  if (input.licenseExpiration !== undefined) out.license_expiration = input.licenseExpiration;
  return out;
}

export async function createProvider(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: ProviderInput,
): Promise<{ id: string }> {
  const { data, error } = await client.from("providers")
    .insert({ org_id: ctx.orgId, ...providerColumns(input) })
    .select("id").single();
  if (error) throw new Error(`createProvider failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

export async function updateProvider(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, id: string, input: ProviderInput,
): Promise<void> {
  const { error } = await client.from("providers")
    .update(providerColumns(input))
    .eq("id", id).eq("org_id", ctx.orgId);
  if (error) throw new Error(`updateProvider failed: ${error.message}`);
}

export async function softDeleteProvider(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, id: string,
): Promise<void> {
  const { error } = await client.from("providers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id).eq("org_id", ctx.orgId);
  if (error) throw new Error(`softDeleteProvider failed: ${error.message}`);
}

export async function upsertEnrollment(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: EnrollmentInput,
): Promise<void> {
  const { error } = await client.from("payer_enrollments").upsert({
    org_id: ctx.orgId, provider_id: input.providerId, payer_id: input.payerDirectoryId,
    status: input.status, par_status: input.parStatus ?? null,
    effective_date: input.effectiveDate ?? null, termination_date: input.terminationDate ?? null,
    revalidation_due: input.revalidationDue ?? null, caqh_id: input.caqhId ?? null,
    notes: input.notes ?? null,
  }, { onConflict: "org_id,provider_id,payer_id" });
  if (error) throw new Error(`upsertEnrollment failed: ${error.message}`);
}
