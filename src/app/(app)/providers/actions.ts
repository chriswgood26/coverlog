"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { createProvider, softDeleteProvider } from "@/lib/providers/mutations";

async function adminCtxOrRedirect() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") throw new Error("Admin role required");
  return { supabase, ctx };
}

export async function createProviderAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await createProvider(supabase, ctx, {
    name: String(formData.get("name") ?? "").trim(),
    npi: String(formData.get("npi") ?? "").trim() || undefined,
    licenseType: String(formData.get("licenseType") ?? "").trim() || undefined,
    licenseNumber: String(formData.get("licenseNumber") ?? "").trim() || undefined,
    licenseState: String(formData.get("licenseState") ?? "").trim() || undefined,
    licenseExpiration: String(formData.get("licenseExpiration") ?? "").trim() || undefined,
  });
  revalidatePath("/providers");
}

export async function deleteProviderAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await softDeleteProvider(supabase, ctx, String(formData.get("id")));
  revalidatePath("/providers");
}
