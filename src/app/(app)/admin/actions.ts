"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { setStaffRole, deactivateStaff, reactivateStaff } from "@/lib/staff/mutations";

async function adminCtxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  return { supabase, ctx };
}

export async function setStaffRoleAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  const role = String(formData.get("role")) === "admin" ? "admin" : "specialist";
  await setStaffRole(supabase, ctx, String(formData.get("staffId")), role);
  revalidatePath("/admin/staff");
}

export async function deactivateStaffAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await deactivateStaff(supabase, ctx, String(formData.get("staffId")));
  revalidatePath("/admin/staff");
}

export async function reactivateStaffAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await reactivateStaff(supabase, ctx, String(formData.get("staffId")));
  revalidatePath("/admin/staff");
}
