import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

export type AddPatientInput = {
  name: string;
  memberId?: string;
  primaryPayer?: string;
  dob?: string;
};

// Insert a new patient scoped to the caller's org (RLS enforces org_id too).
export async function addPatient(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: AddPatientInput,
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("patients")
    .insert({
      org_id: ctx.orgId,
      name: input.name,
      member_id: input.memberId ?? null,
      primary_payer: input.primaryPayer ?? null,
      dob: input.dob ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(`addPatient failed: ${error.message}`);
  return { id: (data as { id: string }).id };
}

// Soft-delete a patient (hide from lists). RLS scopes the update to the caller's org.
export async function softDeletePatient(
  client: Pick<SupabaseClient, "from">, id: string,
): Promise<void> {
  const { error } = await client
    .from("patients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`softDeletePatient failed: ${error.message}`);
}

export type LogCheckInput = {
  patientId: string;
  payer?: string;
  status: "verified" | "pending" | "inactive";
  copay?: number;
  deductibleRemaining?: number;
  notes?: string;
  nextDue?: string;
};

// Atomic insert-check + update-patient via the SECURITY INVOKER RPC.
export async function logCheck(
  client: Pick<SupabaseClient, "rpc">, input: LogCheckInput,
): Promise<{ checkId: string }> {
  const { data, error } = await client.rpc("log_eligibility_check", {
    p_patient_id: input.patientId,
    p_payer: input.payer ?? null,
    p_status: input.status,
    p_copay: input.copay ?? null,
    p_deductible_remaining: input.deductibleRemaining ?? null,
    p_notes: input.notes ?? null,
    p_next_due: input.nextDue ?? null,
  });
  if (error) throw new Error(`logCheck failed: ${error.message}`);
  return { checkId: data as string };
}
