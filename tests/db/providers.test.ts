import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { createProvider, updateProvider, softDeleteProvider, upsertEnrollment } from "@/lib/providers/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const CTX_A = { orgId: ORG_A, staffId: "s", role: "admin" as const };
let payerDirA: string;
let clientA: ReturnType<typeof createClient>;
let clientB: ReturnType<typeof createClient>;

async function signedInClient(email: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  return c;
}

beforeAll(async () => {
  const a = await admin.auth.admin.createUser({ email: "prov-a@example.com", password: "Test-Passw0rd!", email_confirm: true });
  const b = await admin.auth.admin.createUser({ email: "prov-b@example.com", password: "Test-Passw0rd!", email_confirm: true });
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin'),($3,$4,'Bo','b@b.com','admin')`,
            [ORG_A, a.data!.user!.id, ORG_B, b.data!.user!.id]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name) values ($1,'Aetna') returning id`, [ORG_A]);
    payerDirA = pd.rows[0].id;
  });
  clientA = await signedInClient("prov-a@example.com");
  clientB = await signedInClient("prov-b@example.com");
});

afterAll(async () => {
  for (const email of ["prov-a@example.com", "prov-b@example.com"]) {
    const u = (await admin.auth.admin.listUsers()).data.users.find((x) => x.email === email);
    if (u) await admin.auth.admin.deleteUser(u.id);
  }
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers,
                          public.payer_directory restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("provider mutations", () => {
  it("createProvider writes an org-scoped row", async () => {
    const { id } = await createProvider(clientA, CTX_A, {
      name: "Dr A", npi: "1234567893", licenseType: "LCSW", licenseExpiration: "2027-01-01" });
    const rows = await asAdmin(async (q) =>
      (await q(`select org_id, name, license_type from public.providers where id=$1`, [id])).rows);
    expect(rows[0]).toMatchObject({ org_id: ORG_A, name: "Dr A", license_type: "LCSW" });
  });

  it("updateProvider edits the org's provider; softDeleteProvider hides it", async () => {
    const { id } = await createProvider(clientA, CTX_A, { name: "Dr Edit" });
    await updateProvider(clientA, CTX_A, id, { licenseState: "CA" });
    await softDeleteProvider(clientA, CTX_A, id);
    const rows = await asAdmin(async (q) =>
      (await q(`select license_state, deleted_at from public.providers where id=$1`, [id])).rows);
    expect(rows[0].license_state).toBe("CA");
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("upsertEnrollment is idempotent on (org, provider, payer)", async () => {
    const { id: providerId } = await createProvider(clientA, CTX_A, { name: "Dr Enr" });
    await upsertEnrollment(clientA, CTX_A, { providerId, payerDirectoryId: payerDirA, status: "pending" });
    await upsertEnrollment(clientA, CTX_A, { providerId, payerDirectoryId: payerDirA, status: "enrolled", caqhId: "CAQH9" });
    const rows = await asAdmin(async (q) =>
      (await q(`select status, caqh_id from public.payer_enrollments where provider_id=$1 and payer_id=$2`,
               [providerId, payerDirA])).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "enrolled", caqh_id: "CAQH9" });
  });

  it("another org cannot see org A's providers (RLS)", async () => {
    const { id } = await createProvider(clientA, CTX_A, { name: "Dr Secret" });
    const { data } = await clientB.from("providers").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });
});
