"use server";

import { Pool } from "pg";
import { createServerSupabase } from "@/lib/supabase/server";
import { createOrgWithFirstAdmin } from "@/lib/onboarding";
import { redirect } from "next/navigation";

export async function submitOnboarding(formData: FormData) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  try {
    await createOrgWithFirstAdmin(pool, {
      userId: user!.id,
      email: user!.email ?? "",
      orgName: String(formData.get("orgName") ?? "").trim(),
      adminName: String(formData.get("adminName") ?? "").trim(),
    });
  } finally {
    await pool.end();
  }
  redirect("/dashboard");
}
