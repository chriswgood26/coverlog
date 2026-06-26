import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { grantConsent, revokeConsent, listConsentsForPatient, hasValidConsent } from "@/lib/phi/consent";

const ORG = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userId: string; let userClient: ReturnType<typeof createClient>;
let staffId: string; let patientId: string;
let ctx: { orgId: string; staffId: string; role: "admin" };

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({ email: "consent-admin@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.disclosure_log, public.patient_consents, public.patients,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG]);
    const s = await q(`insert into public.staff (org_id, user_id, name, email, role)
                       values ($1,$2,'Al','al@a.com','admin') returning id`, [ORG, userId]);
    staffId = s.rows[0].id;
    const p = await q(`insert into public.patients (org_id, name) values ($1,'Pat') returning id`, [ORG]);
    patientId = p.rows[0].id;
  });
  ctx = { orgId: ORG, staffId, role: "admin" };
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "consent-admin@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId);
  await asAdmin((q) => q(`truncate table public.disclosure_log, public.patient_consents,
                          public.patients, public.staff, public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("consent admin", () => {
  it("grantConsent inserts a consent row and logs consent_granted", async () => {
    const { id } = await grantConsent(userClient, ctx, { patientId, consentType: "part2_disclosure", scope: "billing" });
    expect(id).toBeTruthy();
    expect(await hasValidConsent(userClient, patientId)).toBe(true);
    const log = await asAdmin(async (q) =>
      (await q(`select action, patient_id from public.disclosure_log where patient_id=$1`, [patientId])).rows);
    expect(log.some((r: any) => r.action === "consent_granted")).toBe(true);
  });

  it("revokeConsent sets revoked_at, flips hasValidConsent false, and logs consent_revoked", async () => {
    const rows = await listConsentsForPatient(userClient, patientId);
    await revokeConsent(userClient, ctx, rows[0].id);
    expect(await hasValidConsent(userClient, patientId)).toBe(false);
    const log = await asAdmin(async (q) =>
      (await q(`select action from public.disclosure_log where patient_id=$1`, [patientId])).rows);
    expect(log.some((r: any) => r.action === "consent_revoked")).toBe(true);
  });
});
