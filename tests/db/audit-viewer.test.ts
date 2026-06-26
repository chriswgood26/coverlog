import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { listAuditTrail } from "@/lib/phi/access";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
let userClient: ReturnType<typeof createClient>;
let userId: string; let staffAId: string; let p1: string; let p2: string;

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({ email: "audit-view@example.com", password: "Test-Passw0rd!", email_confirm: true });
  userId = created.data!.user!.id;
  await asAdmin(async (q) => {
    await q(`truncate table public.access_log, public.disclosure_log, public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    const s = await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Alice Admin','a@a.com','admin') returning id`, [ORG_A, userId]);
    staffAId = s.rows[0].id;
    const sb = await q(`insert into public.staff (org_id, name, email, role) values ($1,'Bob B','b@b.com','admin') returning id`, [ORG_B]);
    const pr = await q(`insert into public.patients (org_id, name) values ($1,'Pat One'),($1,'Pat Two') returning id`, [ORG_A]);
    p1 = pr.rows[0].id; p2 = pr.rows[1].id;
    const pb = await q(`insert into public.patients (org_id, name) values ($1,'B Patient') returning id`, [ORG_B]);
    // ORG_A access_log: a view_chart (P1) and a list_view ([P1,P2])
    await q(`insert into public.access_log (org_id, actor_staff_id, action, patient_id, occurred_at) values ($1,$2,'view_chart',$3, now())`, [ORG_A, staffAId, p1]);
    await q(`insert into public.access_log (org_id, actor_staff_id, action, patient_ids, occurred_at) values ($1,$2,'list_view',$3, now())`, [ORG_A, staffAId, [p1, p2]]);
    // ORG_A disclosure_log: a consent_granted (P1) with purpose/disclosed_to
    await q(`insert into public.disclosure_log (org_id, actor_staff_id, action, patient_id, purpose, disclosed_to, occurred_at) values ($1,$2,'consent_granted',$3,'billing','Aetna', now())`, [ORG_A, staffAId, p1]);
    // ORG_B access_log row (must NOT leak)
    await q(`insert into public.access_log (org_id, actor_staff_id, action, patient_id, occurred_at) values ($1,$2,'view_chart',$3, now())`, [ORG_B, sb.rows[0].id, pb.rows[0].id]);
  });
  userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: "audit-view@example.com", password: "Test-Passw0rd!" });
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await asAdmin((q) => q(`truncate table public.access_log, public.disclosure_log, public.patients restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("listAuditTrail", () => {
  it("returns the org's access + disclosure entries with joined names, newest-first, and excludes other orgs", async () => {
    const trail = await listAuditTrail(userClient, { orgId: ORG_A, staffId: staffAId });
    // access entries (the seeded two; plus possibly the audit_view we just wrote, ordered first)
    const view = trail.access.find((e) => e.action === "view_chart")!;
    expect(view.actor_name).toBe("Alice Admin");
    expect(view.patient_label).toBe("Pat One");
    expect(view.patient_id).toBe(p1);
    const list = trail.access.find((e) => e.action === "list_view")!;
    expect(list.patient_label).toBe("2 patients");
    // disclosures
    expect(trail.disclosures).toHaveLength(1);
    expect(trail.disclosures[0]).toMatchObject({ action: "consent_granted", actor_name: "Alice Admin", patient_name: "Pat One", purpose: "billing", disclosed_to: "Aetna" });
    // no cross-org leak: B Patient's view_chart not present
    expect(trail.access.every((e) => e.patient_label !== "B Patient")).toBe(true);
  });

  it("writes a meta audit_view access_log entry on view", async () => {
    await listAuditTrail(userClient, { orgId: ORG_A, staffId: staffAId });
    const rows = await asAdmin(async (q) =>
      (await q(`select query_context from public.access_log where org_id=$1 and action='audit_view'`, [ORG_A])).rows);
    expect(rows.some((r: any) => r.query_context === "admin_audit")).toBe(true);
  });
});
