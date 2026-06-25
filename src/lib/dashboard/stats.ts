import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardStats = {
  verifiedToday: number;
  dueThisWeek: number;
  needsAttention: number;
};

async function count(
  client: Pick<SupabaseClient, "from">, build: (q: any) => any,
): Promise<number> {
  const base = client.from("patients").select("*", { count: "exact", head: true }).is("deleted_at", null);
  const { count, error } = await build(base);
  if (error) throw new Error(`dashboard count failed: ${error.message}`);
  return count ?? 0;
}

export async function getDashboardStats(
  client: Pick<SupabaseClient, "from">,
): Promise<DashboardStats> {
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [verifiedToday, dueThisWeek, needsAttention] = await Promise.all([
    count(client, (q) => q.eq("status", "verified").eq("last_checked", today)),
    count(client, (q) => q.gte("next_due", today).lte("next_due", weekOut)),
    count(client, (q) => q.in("status", ["pending", "inactive"])),
  ]);
  return { verifiedToday, dueThisWeek, needsAttention };
}
