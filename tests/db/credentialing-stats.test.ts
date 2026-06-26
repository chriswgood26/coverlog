import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { getCredentialingStats } from "@/lib/dashboard/stats";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userClient: ReturnType<typeof createClient>;
let createdUserId: string;

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({
    email: "cred-stats@example.com", password: "Test-Passw0rd!", email_confirm: true });
  createdUserId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_enrollments, public.providers, public.payer_directory,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, createdUserId]);
    const pd = await q(`insert into public.payer_directory (org_id, payer_name) values ($1,'Aetna') returning id`, [ORG_A]);
    const pr = await q(`insert into public.providers (org_id, name, license_expiration)
                        values ($1,'Dr Soon', current_date + 20) returning id`, [ORG_A]);
    await q(`insert into public.providers (org_id, name, license_expiration)
             values ($1,'Dr Later', current_date + 120)`, [ORG_A]);   // outside window
    await q(`insert into public.payer_enrollments (org_id, provider_id, payer_id, status, revalidation_due)
             values ($1,$2,$3,'enrolled', current_date + 5)`, [ORG_A, pr.rows[0].id, pd.rows[0].id]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "cred-stats@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
  await asAdmin((q) => q(`truncate table public.payer_enrollments, public.providers,
                          public.payer_directory restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("getCredentialingStats", () => {
  it("returns 60-day-window counts scoped to the caller's org", async () => {
    const stats = await getCredentialingStats(userClient);
    expect(stats.licensesExpiring).toBe(1);   // Dr Soon (20d), not Dr Later (120d)
    expect(stats.revalidationsDue).toBe(1);
  });
});
