"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { upsertMasterPayer } from "@/lib/payers/curation";

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
