import type { SupabaseClient } from "@supabase/supabase-js";
import { logDisclosure } from "@/lib/phi/disclosure";
import type { StaffContext } from "@/lib/auth/context";

export type ConsentRow = {
  id: string; consent_type: string; scope: string | null;
  granted_at: string | null; expires_at: string | null;
  revoked_at: string | null; document_ref: string | null;
};
export type GrantConsentInput = {
  patientId: string; consentType: string;
  scope?: string; expiresAt?: string; documentRef?: string;
};

export async function grantConsent(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, input: GrantConsentInput,
): Promise<{ id: string }> {
  const { data, error } = await client.from("patient_consents").insert({
    org_id: ctx.orgId, patient_id: input.patientId, consent_type: input.consentType,
    scope: input.scope ?? null, granted_at: new Date().toISOString(),
    expires_at: input.expiresAt ?? null, document_ref: input.documentRef ?? null,
    created_by: ctx.staffId,
  }).select("id").single();
  if (error) throw new Error(`grantConsent failed: ${error.message}`);
  await logDisclosure(client, ctx, {
    action: "consent_granted", patient_id: input.patientId,
    detail: { consent_type: input.consentType },
  });
  return { id: (data as { id: string }).id };
}

export async function revokeConsent(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, consentId: string,
): Promise<void> {
  const { data: row, error: fErr } = await client.from("patient_consents")
    .select("patient_id").eq("id", consentId).maybeSingle();
  if (fErr) throw new Error(`revokeConsent failed: ${fErr.message}`);
  const { error } = await client.from("patient_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", consentId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`revokeConsent failed: ${error.message}`);
  await logDisclosure(client, ctx, {
    action: "consent_revoked",
    patient_id: (row as { patient_id: string } | null)?.patient_id ?? null,
    detail: { consent_id: consentId },
  });
}

export async function listConsentsForPatient(
  client: Pick<SupabaseClient, "from">, patientId: string,
): Promise<ConsentRow[]> {
  const { data, error } = await client.from("patient_consents")
    .select("id, consent_type, scope, granted_at, expires_at, revoked_at, document_ref")
    .eq("patient_id", patientId).order("created_at", { ascending: false });
  if (error) throw new Error(`listConsentsForPatient failed: ${error.message}`);
  return (data ?? []) as ConsentRow[];
}

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
