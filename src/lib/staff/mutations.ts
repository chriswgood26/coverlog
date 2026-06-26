import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/context";

// Throw if the change would remove the org's last active admin. RLS scopes both
// queries to the caller's org, so the count is per-org.
async function assertNotLastAdmin(
  client: Pick<SupabaseClient, "from">, staffId: string,
): Promise<void> {
  const { data: target, error: tErr } = await client.from("staff")
    .select("role, deleted_at").eq("id", staffId).maybeSingle();
  if (tErr) throw new Error(`assertNotLastAdmin failed: ${tErr.message}`);
  // Only removing an ACTIVE admin can drop the admin count.
  if (!target || target.role !== "admin" || target.deleted_at) return;
  const { count, error: cErr } = await client.from("staff")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin").is("deleted_at", null).neq("id", staffId);
  if (cErr) throw new Error(`assertNotLastAdmin failed: ${cErr.message}`);
  if ((count ?? 0) === 0) throw new Error("cannot remove the last admin");
}

export async function setStaffRole(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext,
  staffId: string, role: "admin" | "specialist",
): Promise<void> {
  if (role === "specialist") await assertNotLastAdmin(client, staffId);
  const { error } = await client.from("staff")
    .update({ role }).eq("id", staffId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`setStaffRole failed: ${error.message}`);
}

export async function deactivateStaff(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, staffId: string,
): Promise<void> {
  await assertNotLastAdmin(client, staffId);
  const { error } = await client.from("staff")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", staffId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`deactivateStaff failed: ${error.message}`);
}

export async function reactivateStaff(
  client: Pick<SupabaseClient, "from">, ctx: StaffContext, staffId: string,
): Promise<void> {
  const { error } = await client.from("staff")
    .update({ deleted_at: null }).eq("id", staffId).eq("org_id", ctx.orgId);
  if (error) throw new Error(`reactivateStaff failed: ${error.message}`);
}
