import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { upsertOrgCoverage } from "@/lib/payers/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let masterId: string;
let createdUserId: string;
let userClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  const { data: created } = await admin.auth.admin.createUser({
    email: "payer-mut-it@example.com",
    password: "Test-Passw0rd!",
    email_confirm: true,
  });
  createdUserId = created!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.payer_code_coverage, public.payer_master,
             public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, createdUserId]);
    const m = await q(`insert into public.payer_master (name) values ('Aetna') returning id`);
    masterId = m.rows[0].id;
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "payer-mut-it@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(createdUserId);
  await asAdmin((q) => q(`truncate table public.payer_master restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("upsertOrgCoverage", () => {
  it("writes an org coverage row scoped to the caller's org", async () => {
    await upsertOrgCoverage(userClient, { orgId: ORG_A, staffId: "s", role: "admin" }, {
      payerMasterId: masterId,
      cptCode: "90837",
      covered: false,
      modifierRequired: "HE",
    });
    const rows = await asAdmin(async (q) =>
      (
        await q(
          `select org_id, cpt_code, covered, modifier_required, source
           from public.payer_code_coverage where payer_master_id=$1`,
          [masterId],
        )
      ).rows,
    );
    expect(rows[0]).toMatchObject({
      org_id: ORG_A,
      cpt_code: "90837",
      covered: false,
      modifier_required: "HE",
      source: "org",
    });
  });
});
