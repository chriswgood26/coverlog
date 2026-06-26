"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { upsertMasterPayer, upsertBaselineCoverage, upsertBaselineClaimRule } from "@/lib/payers/curation";

export async function addMasterPayerAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const payerType = String(formData.get("payerType") ?? "").trim() || undefined;
  await upsertMasterPayer(createServiceSupabase(), { name, payerType });
  revalidatePath("/internal/curation");
}

export async function addBaselineCoverageAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const payerMasterId = String(formData.get("payerMasterId") ?? "");
  const cptCode = String(formData.get("cptCode") ?? "").trim();
  if (!payerMasterId || !cptCode) return;
  const tele = String(formData.get("telehealthAllowed") ?? "");
  await upsertBaselineCoverage(createServiceSupabase(), {
    payerMasterId, cptCode,
    covered: formData.get("covered") === "on",
    requiresPriorAuth: formData.get("requiresPriorAuth") === "on",
    telehealthAllowed: tele === "yes" ? true : tele === "no" ? false : undefined,
    modifierRequired: String(formData.get("modifierRequired") ?? "").trim() || undefined,
    unitLimit: String(formData.get("unitLimit") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    verifiedBy: platform.email,
  });
  revalidatePath(`/internal/curation/${payerMasterId}`);
}

export async function addBaselineClaimRuleAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const payerMasterId = String(formData.get("payerMasterId") ?? "");
  const ruleCategory = String(formData.get("ruleCategory") ?? "").trim();
  if (!payerMasterId || !ruleCategory) return;
  await upsertBaselineClaimRule(createServiceSupabase(), {
    payerMasterId, ruleCategory,
    fieldReference: String(formData.get("fieldReference") ?? "").trim() || undefined,
    ruleDescription: String(formData.get("ruleDescription") ?? "").trim() || undefined,
    requiredValue: String(formData.get("requiredValue") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    verifiedBy: platform.email,
  });
  revalidatePath(`/internal/curation/${payerMasterId}`);
}
