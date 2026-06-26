"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { setOrgStatus, type OrgStatus } from "@/lib/orgs/admin";

export async function setOrgStatusAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in"); // re-verify superadmin; never trust the client
  const orgId = String(formData.get("orgId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!orgId || (status !== "active" && status !== "disabled")) return;
  await setOrgStatus(createServiceSupabase(), orgId, status as OrgStatus);
  revalidatePath("/internal/orgs");
}
