import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardStats = {
  verifiedToday: number;
  dueThisWeek: number;
  needsAttention: number;
};

export async function getDashboardStats(
  client: Pick<SupabaseClient, "rpc">,
): Promise<DashboardStats> {
  const { data, error } = await client.rpc("dashboard_stats");
  if (error) throw new Error(`dashboard stats failed: ${error.message}`);
  // `returns table (...)` comes back as an array of rows; we expect exactly one.
  const row = (data ?? [])[0] ?? {};
  return {
    verifiedToday: Number(row.verified_today ?? 0),
    dueThisWeek: Number(row.due_this_week ?? 0),
    needsAttention: Number(row.needs_attention ?? 0),
  };
}

export type CredentialingStats = {
  licensesExpiring: number;
  revalidationsDue: number;
};

export async function getCredentialingStats(
  client: Pick<SupabaseClient, "rpc">,
): Promise<CredentialingStats> {
  const { data, error } = await client.rpc("credentialing_stats");
  if (error) throw new Error(`credentialing stats failed: ${error.message}`);
  const row = (data ?? [])[0] ?? {};
  return {
    licensesExpiring: Number(row.licenses_expiring ?? 0),
    revalidationsDue: Number(row.revalidations_due ?? 0),
  };
}
