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
