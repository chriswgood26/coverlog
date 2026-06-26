import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgStatus = "active" | "disabled";
export type OrgRow = { id: string; name: string; status: OrgStatus; created_at: string };

// Cross-tenant list of all organizations. MUST be called with a service-role client
// (bypasses RLS); used only by the superadmin /internal/orgs surface.
export async function listAllOrgs(svc: Pick<SupabaseClient, "from">): Promise<OrgRow[]> {
  const { data, error } = await svc
    .from("organizations")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listAllOrgs failed: ${error.message}`);
  return (data ?? []) as OrgRow[];
}

// Set an org's status. Service-role client; the DB check constraint rejects bad values.
export async function setOrgStatus(
  svc: Pick<SupabaseClient, "from">, orgId: string, status: OrgStatus,
): Promise<void> {
  const { error } = await svc.from("organizations").update({ status }).eq("id", orgId);
  if (error) throw new Error(`setOrgStatus failed: ${error.message}`);
}
