import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listStaff } from "@/lib/staff/queries";
import { setStaffRole, deactivateStaff, reactivateStaff } from "@/lib/staff/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const CTX_A = { orgId: ORG_A, staffId: "x", role: "admin" as const };
let clientA: Awaited<ReturnType<typeof signedIn>>;
let clientB: Awaited<ReturnType<typeof signedIn>>;
let userIdA: string; let userIdB: string;
let adminAId: string; let admin2Id: string; let specId: string; let bStaffId: string;

async function signedIn(email: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  return c;
}

beforeAll(async () => {
  const a = await admin.auth.admin.createUser({ email: "staff-a@example.com", password: "Test-Passw0rd!", email_confirm: true });
  const b = await admin.auth.admin.createUser({ email: "staff-b@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userIdA = a.data!.user!.id; userIdB = b.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    // org A: the signed-in admin (a), a second admin, and a specialist.
    const r1 = await q(`insert into public.staff (org_id, user_id, name, email, role)
                        values ($1,$2,'Al','al@a.com','admin') returning id`, [ORG_A, userIdA]);
    adminAId = r1.rows[0].id;
    const r2 = await q(`insert into public.staff (org_id, name, email, role)
                        values ($1,'Amy','amy@a.com','admin') returning id`, [ORG_A]);
    admin2Id = r2.rows[0].id;
    const r3 = await q(`insert into public.staff (org_id, name, email, role)
                        values ($1,'Sam','sam@a.com','specialist') returning id`, [ORG_A]);
    specId = r3.rows[0].id;
    // org B: its own admin (signed-in b) for cross-org checks.
    const r4 = await q(`insert into public.staff (org_id, user_id, name, email, role)
                        values ($1,$2,'Bo','bo@b.com','admin') returning id`, [ORG_B, userIdB]);
    bStaffId = r4.rows[0].id;
  });
  clientA = await signedIn("staff-a@example.com");
  clientB = await signedIn("staff-b@example.com");
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userIdA);
  await admin.auth.admin.deleteUser(userIdB);
  await asAdmin((q) => q(`truncate table public.staff, public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("staff management", () => {
  it("listStaff returns the org's staff (admins + specialist)", async () => {
    const rows = await listStaff(clientA);
    expect(rows.map((r) => r.name).sort()).toEqual(["Al", "Amy", "Sam"]);
  });

  it("setStaffRole promotes the specialist to admin", async () => {
    await setStaffRole(clientA, CTX_A, specId, "admin");
    const row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.role).toBe("admin");
    await setStaffRole(clientA, CTX_A, specId, "specialist"); // restore
  });

  it("deactivate + reactivate toggles deleted_at", async () => {
    await deactivateStaff(clientA, CTX_A, specId);
    let row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.deleted_at).not.toBeNull();
    await reactivateStaff(clientA, CTX_A, specId);
    row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.deleted_at).toBeNull();
  });

  it("last-admin guard: cannot demote the only active admin", async () => {
    // Deactivate admin2 so adminAId is the sole active admin.
    await deactivateStaff(clientA, CTX_A, admin2Id);
    await expect(setStaffRole(clientA, CTX_A, adminAId, "specialist"))
      .rejects.toThrow(/last admin/i);
    await expect(deactivateStaff(clientA, CTX_A, adminAId))
      .rejects.toThrow(/last admin/i);
    await reactivateStaff(clientA, CTX_A, admin2Id); // restore
  });

  it("another org cannot modify org A's staff (RLS)", async () => {
    await setStaffRole(clientB, { orgId: ORG_B, staffId: "y", role: "admin" }, specId, "admin");
    // RLS scopes the update to org B → org A's specId is untouched.
    const row = (await listStaff(clientA)).find((r) => r.id === specId)!;
    expect(row.role).toBe("specialist");
  });
});
