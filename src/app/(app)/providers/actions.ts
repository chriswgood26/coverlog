"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { createProvider, softDeleteProvider, updateProvider } from "@/lib/providers/mutations";

const STATUSES = ["active", "pending", "flagged"] as const;
type Status = (typeof STATUSES)[number];
function asStatus(v: unknown): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : "active";
}

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
    specialty: String(formData.get("specialty") ?? "").trim() || undefined,
    status: asStatus(formData.get("status")),
  });
  revalidatePath("/providers");
}

export async function setProviderStatusAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await updateProvider(supabase, ctx, String(formData.get("id")), { status: asStatus(formData.get("status")) });
  revalidatePath("/providers");
}

export async function deleteProviderAction(formData: FormData) {
  const { supabase, ctx } = await adminCtxOrRedirect();
  await softDeleteProvider(supabase, ctx, String(formData.get("id")));
  revalidatePath("/providers");
}
