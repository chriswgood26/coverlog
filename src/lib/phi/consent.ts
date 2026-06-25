import type { SupabaseClient } from "@supabase/supabase-js";

// A consent is valid if granted, not revoked, and not expired.
export async function hasValidConsent(
  client: Pick<SupabaseClient, "from">, patientId: string,
): Promise<boolean> {
  const { data } = await client
    .from("patient_consents")
    .select("id")
    .eq("patient_id", patientId)
    .not("granted_at", "is", null)
    .is("revoked_at", null)
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}
