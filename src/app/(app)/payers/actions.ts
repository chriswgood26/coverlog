"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { upsertOrgCoverage, upsertOrgClaimRule } from "@/lib/payers/mutations";
import { upsertEnrollment } from "@/lib/providers/mutations";

async function ctxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return { supabase, ctx };
}

export async function saveOrgCoverageAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await upsertOrgCoverage(supabase, ctx, {
    payerMasterId: String(formData.get("payerMasterId")),
    cptCode: String(formData.get("cptCode") ?? "").trim(),
    covered: formData.get("covered") === "on",
    requiresPriorAuth: formData.get("requiresPriorAuth") === "on",
    modifierRequired: String(formData.get("modifierRequired") ?? "").trim() || undefined,
  });
  revalidatePath(`/payers/${formData.get("payerDirectoryId")}`);
}

export async function saveOrgClaimRuleAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  await upsertOrgClaimRule(supabase, ctx, {
    payerMasterId: String(formData.get("payerMasterId")),
    ruleCategory: String(formData.get("ruleCategory") ?? "").trim(),
    fieldReference: String(formData.get("fieldReference") ?? "").trim() || undefined,
    ruleDescription: String(formData.get("ruleDescription") ?? "").trim() || undefined,
    requiredValue: String(formData.get("requiredValue") ?? "").trim() || undefined,
  });
  revalidatePath(`/payers/${formData.get("payerDirectoryId")}`);
}

export async function saveEnrollmentAction(formData: FormData) {
  const { supabase, ctx } = await ctxOrRedirect();
  if (ctx.role !== "admin") throw new Error("Admin role required");
  await upsertEnrollment(supabase, ctx, {
    providerId: String(formData.get("providerId")),
    payerDirectoryId: String(formData.get("payerDirectoryId")),
    status: String(formData.get("status") ?? "pending") as
      "enrolled" | "pending" | "terminated" | "not_enrolled",
    parStatus: (String(formData.get("parStatus") ?? "").trim() || undefined) as
      "in_network" | "out_of_network" | undefined,
    effectiveDate: String(formData.get("effectiveDate") ?? "").trim() || undefined,
    revalidationDue: String(formData.get("revalidationDue") ?? "").trim() || undefined,
    caqhId: String(formData.get("caqhId") ?? "").trim() || undefined,
  });
  revalidatePath(`/payers/${formData.get("payerDirectoryId")}`);
}
