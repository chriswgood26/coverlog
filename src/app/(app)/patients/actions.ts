"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { addPatient, logCheck } from "@/lib/patients/mutations";
import { parsePatientsCsv } from "@/lib/csv/import";
import { exportPatientsCsv } from "@/lib/csv/export";

async function ctxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return { supabase, ctx };
}

export async function addPatientAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await addPatient(supabase, ctx, {
    name: String(formData.get("name") ?? "").trim(),
    memberId: String(formData.get("memberId") ?? "").trim() || undefined,
    primaryPayer: String(formData.get("primaryPayer") ?? "").trim() || undefined,
  });
  revalidatePath("/patients");
}

export async function logCheckAction(formData: FormData) {
  const { supabase } = await ctxOrRedirect();
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
