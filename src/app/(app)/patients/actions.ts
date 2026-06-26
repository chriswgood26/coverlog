"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { addPatient, logCheck, softDeletePatient } from "@/lib/patients/mutations";
import { parsePatientsCsv } from "@/lib/csv/import";
import { exportPatientsCsv } from "@/lib/csv/export";
import { grantConsent, revokeConsent } from "@/lib/phi/consent";

async function ctxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return { supabase, ctx };
}

export type AddPatientState = { error?: string; ok?: boolean } | null;

export async function addPatientAction(_prev: AddPatientState, formData: FormData): Promise<AddPatientState> {
  const { supabase, ctx } = await ctxOrRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const memberId = String(formData.get("memberId") ?? "").trim();
  const primaryPayer = String(formData.get("primaryPayer") ?? "").trim();
  if (!name) return { error: "Patient name is required." };

  // Duplicate guard: an active patient in this org with the same name + member ID
  // (case-insensitive; blank member ID counts as blank). RLS scopes the read to the org.
  const { data: existing } = await supabase
    .from("patients").select("name, member_id").eq("org_id", ctx.orgId).is("deleted_at", null);
  const dup = (existing ?? []).some((p: { name: string | null; member_id: string | null }) =>
    (p.name ?? "").trim().toLowerCase() === name.toLowerCase() &&
    (p.member_id ?? "").trim().toLowerCase() === memberId.toLowerCase());
  if (dup) {
    return { error: `A patient named “${name}”${memberId ? ` with member ID ${memberId}` : ""} already exists.` };
  }

  await addPatient(supabase, ctx, {
    name, memberId: memberId || undefined, primaryPayer: primaryPayer || undefined,
  });
  revalidatePath("/patients");
  return { ok: true };
}

export async function deletePatientAction(formData: FormData) {
  const { supabase } = await ctxOrRedirect();
  await softDeletePatient(supabase, String(formData.get("id")));
  revalidatePath("/patients");
}

export async function logCheckAction(formData: FormData) {
  const { supabase } = await ctxOrRedirect();
  // Cross-org/nonexistent patientId is rejected inside the log_eligibility_check RPC (RLS-scoped existence guard, migration 0008); no pre-check needed here.
  await logCheck(supabase, {
    patientId: String(formData.get("patientId")),
    payer: String(formData.get("payer") ?? "").trim() || undefined,
    status: String(formData.get("status")) as "verified" | "pending" | "inactive",
    copay: formData.get("copay") ? Number(formData.get("copay")) : undefined,
    deductibleRemaining: formData.get("deductible") ? Number(formData.get("deductible")) : undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    nextDue: String(formData.get("nextDue") ?? "") || undefined,
  });
  revalidatePath(`/patients/${formData.get("patientId")}`);
  revalidatePath("/patients");
}

export async function importCsvAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  const text = await (formData.get("file") as File).text();
  const { rows } = parsePatientsCsv(text, ctx.orgId);
  if (rows.length) {
    const { error } = await supabase.from("patients").insert(rows);
    if (error) throw new Error(`CSV import failed: ${error.message}`);
  }
  revalidatePath("/patients");
}

export async function exportCsvAction(): Promise<string> {
  const { supabase, ctx } = await ctxOrRedirect();
  return exportPatientsCsv(supabase, ctx, { purpose: "self-service export" });
}

export async function linkPatientPayerAction(formData: FormData) {
  const { supabase } = await ctxOrRedirect();
  const patientId = String(formData.get("patientId"));
  const payerDirectoryId = String(formData.get("payerDirectoryId")) || null;
  const { error } = await supabase.from("patients")
    .update({ primary_payer_directory_id: payerDirectoryId })
    .eq("id", patientId);
  if (error) throw new Error(`linkPatientPayer failed: ${error.message}`);
  revalidatePath(`/patients/${patientId}`);
}

export async function grantConsentAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await grantConsent(supabase, ctx, {
    patientId: String(formData.get("patientId")),
    consentType: String(formData.get("consentType") ?? "").trim() || "part2_disclosure",
    scope: String(formData.get("scope") ?? "").trim() || undefined,
    expiresAt: String(formData.get("expiresAt") ?? "").trim() || undefined,
    documentRef: String(formData.get("documentRef") ?? "").trim() || undefined,
  });
  revalidatePath(`/patients/${formData.get("patientId")}`);
}

export async function revokeConsentAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await revokeConsent(supabase, ctx, String(formData.get("consentId")));
  revalidatePath(`/patients/${formData.get("patientId")}`);
}
