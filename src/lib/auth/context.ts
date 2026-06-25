import type { SupabaseClient } from "@supabase/supabase-js";

export type StaffContext = {
  orgId: string;
  staffId: string;
  role: "admin" | "specialist";
};

// Resolve the current Supabase Auth user to their staff/org context.
// Returns null if unauthenticated or not linked to a (non-deleted) staff row.
export async function getStaffContext(
  client: Pick<SupabaseClient, "auth" | "from">,
): Promise<StaffContext | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const { data } = await client
    .from("staff")
    .select("id, org_id, role")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data) return null;
  return { orgId: data.org_id, staffId: data.id, role: data.role };
}
