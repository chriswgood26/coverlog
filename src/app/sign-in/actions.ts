"use server";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function signInAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}
