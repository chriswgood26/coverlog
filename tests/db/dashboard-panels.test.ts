import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listPendingVerifications } from "@/lib/phi/access";
import { listExpiringCredentials } from "@/lib/providers/queries";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userClient: ReturnType<typeof createClient>;
let userId: string;
let staffAId: string;

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({ email: "dash-panels@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.access_log, public.providers, public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    const s = await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Al','a@a.com','admin') returning id`, [ORG_A, userId]);
    staffAId = s.rows[0].id;
    // ORG_A patients: one pending (counted), one verified (not), one pending-but-deleted (not).
    await q(`insert into public.patients (org_id, name, primary_payer, member_id, status) values
      ($1,'Pat Pending','Aetna','MBI-1','pending'),
      ($1,'Pat Verified','Cigna','MBI-2','verified')`, [ORG_A]);
    await q(`insert into public.patients (org_id, name, status, deleted_at) values ($1,'Pat Gone','pending', now())`, [ORG_A]);
    // ORG_B pending patient (must NOT leak to ORG_A).
    await q(`insert into public.patients (org_id, name, status) values ($1,'B Pending','pending')`, [ORG_B]);
    // ORG_A providers for expiring credentials.
    await q(`insert into public.providers (org_id, name, license_type, license_expiration) values
      ($1,'Dr Near','LCSW', current_date + 20),
      ($1,'Dr Far','LMFT', current_date + 200)`, [ORG_A]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "dash-panels@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await asAdmin((q) => q(`truncate table public.access_log, public.providers, public.patients restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("listPendingVerifications", () => {
  it("returns only this org's pending, non-deleted patients and logs a list_view", async () => {
    const rows = await listPendingVerifications(userClient, { orgId: ORG_A, staffId: staffAId });
    expect(rows.map((r) => r.name)).toEqual(["Pat Pending"]);
    expect(rows[0]).toMatchObject({ primary_payer: "Aetna", member_id: "MBI-1" });
    const logged = await asAdmin(async (q) =>
      (await q(`select action, query_context from public.access_log where org_id=$1 and action='list_view'`, [ORG_A])).rows);
    expect(logged.some((r: any) => r.query_context === "dashboard_pending")).toBe(true);
  });
});

describe("listExpiringCredentials", () => {
  it("returns providers with licenses within 60 days, excludes far-future", async () => {
    const rows = await listExpiringCredentials(userClient);
    expect(rows.map((r) => r.name)).toEqual(["Dr Near"]);
    expect(rows[0]).toMatchObject({ license_type: "LCSW" });
  });
});
