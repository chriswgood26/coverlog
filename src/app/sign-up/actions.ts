"use server";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function signUpAction(formData: FormData) {
  const supabase = await createServerSupabase();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) redirect(`/sign-up?error=${encodeURIComponent(error.message)}`);
  // If the project requires email confirmation, there's no session yet — try to
  // sign in; on failure, tell the user to confirm via email.
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) redirect(`/sign-in?error=${encodeURIComponent("Check your email to confirm your account.")}`);
  redirect("/onboarding");
}
