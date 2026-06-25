import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { resolveCoverage } from "@/lib/payers/resolve";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let masterId: string;
let userId: string;
let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  const { data: created } = await admin.auth.admin.createUser({
    email: "payer-resolve-it@example.com", password: "Test-Passw0rd!", email_confirm: true,
  });
  userId = created!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_directory,
             public.payer_master, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, userId]);
    const m = await q(`insert into public.payer_master (name) values ('Aetna') returning id`);
    masterId = m.rows[0].id;
    // Baseline covers 90837 and 90834; org overrides ONLY 90837 (covered=false).
    await q(`insert into public.payer_code_coverage (org_id, payer_master_id, cpt_code, covered, source)
             values (null,$1,'90837',true,'coverlog_baseline'),
                    (null,$1,'90834',true,'coverlog_baseline'),
                    ($2,$1,'90837',false,'org')`, [masterId, ORG_A]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "payer-resolve-it@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId);
  await asAdmin((q) => q(`truncate table public.payer_master restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("resolveCoverage precedence", () => {
  it("org override wins for 90837; baseline shows for 90834", async () => {
    const rows = await resolveCoverage(userClient, masterId);
    const byCode = Object.fromEntries(rows.map(r => [r.cpt_code, r]));
    expect(byCode["90837"].covered).toBe(false);
    expect(byCode["90837"].provenance).toBe("org");
    expect(byCode["90834"].covered).toBe(true);
    expect(byCode["90834"].provenance).toBe("coverlog_baseline");
  });
});
