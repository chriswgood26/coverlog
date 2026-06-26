import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformContext = { userId: string; email: string };

// Resolve the current Supabase Auth user to a platform (superadmin) context.
// Superadmin iff the user's email is in the SUPERADMIN_EMAILS allowlist (bootstrap)
// OR a public.superadmins row exists for them (read via the self-read RLS policy).
// Returns null if unauthenticated or not a superadmin.
export async function getPlatformContext(
  client: Pick<SupabaseClient, "auth" | "from">,
): Promise<PlatformContext | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const email = user.email ?? "";
  const allow = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && allow.includes(email.toLowerCase())) {
    return { userId: user.id, email };
  }

  const { data } = await client
    .from("superadmins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return { userId: user.id, email };
}
