import type { SupabaseClient } from "@supabase/supabase-js";

export type StaffRow = {
  id: string; name: string; email: string;
  role: "admin" | "specialist"; user_id: string | null; deleted_at: string | null;
};

export async function listStaff(
  client: Pick<SupabaseClient, "from">,
): Promise<StaffRow[]> {
  const { data, error } = await client.from("staff")
    .select("id, name, email, role, user_id, deleted_at").order("name");
  if (error) throw new Error(`listStaff failed: ${error.message}`);
  return (data ?? []) as StaffRow[];
}
