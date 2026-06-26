import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listAllOrgs, setOrgStatus } from "@/lib/orgs/admin";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let userId: string;
let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  const created = await service.auth.admin.createUser({ email: "org-status@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Alice','a@a.com','admin')`, [ORG_A, userId]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "org-status@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (userId) await service.auth.admin.deleteUser(userId);
  await resetDb();
  await pool.end();
});

describe("org status", () => {
  it("defaults new orgs to 'active'", async () => {
    const rows = await asAdmin(async (q) =>
      (await q(`select status from public.organizations where id=$1`, [ORG_A])).rows);
    expect(rows[0].status).toBe("active");
  });

  it("setOrgStatus flips status (service role)", async () => {
    await setOrgStatus(service, ORG_B, "disabled");
    let rows = await asAdmin(async (q) => (await q(`select status from public.organizations where id=$1`, [ORG_B])).rows);
    expect(rows[0].status).toBe("disabled");
    await setOrgStatus(service, ORG_B, "active");
    rows = await asAdmin(async (q) => (await q(`select status from public.organizations where id=$1`, [ORG_B])).rows);
    expect(rows[0].status).toBe("active");
  });

  it("setOrgStatus rejects an invalid status (check constraint)", async () => {
    await expect(setOrgStatus(service, ORG_B, "bogus" as any)).rejects.toThrow();
  });

  it("listAllOrgs returns all orgs across tenants with their statuses", async () => {
    await setOrgStatus(service, ORG_A, "active");
    await setOrgStatus(service, ORG_B, "disabled");
    const orgs = await listAllOrgs(service);
    const a = orgs.find((o) => o.id === ORG_A)!;
    const b = orgs.find((o) => o.id === ORG_B)!;
    expect(a.status).toBe("active");
    expect(b.status).toBe("disabled");
  });

  it("a tenant can read its own org status but not another org's (RLS)", async () => {
    const own = await userClient.from("organizations").select("status").eq("id", ORG_A).maybeSingle();
    expect(own.data).not.toBeNull();
    const other = await userClient.from("organizations").select("status").eq("id", ORG_B).maybeSingle();
    expect(other.data).toBeNull();
  });
});
