import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { pool, asAdmin, resetDb } from "./helpers";
import { runWeeklyDigest } from "@/lib/email/runDigest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const svc = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const ORG_HIT = "11111111-1111-1111-1111-111111111111";   // has signals + active admin
const ORG_ZERO = "22222222-2222-2222-2222-222222222222";  // no signals → skipped
const ORG_NOADMIN = "33333333-3333-3333-3333-333333333333"; // signals but no admin → skipped

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.providers, public.patients, public.staff, public.organizations
             restart identity cascade`);
    await q(`insert into public.organizations (id, name)
             values ($1,'HitOrg'),($2,'ZeroOrg'),($3,'NoAdminOrg')`, [ORG_HIT, ORG_ZERO, ORG_NOADMIN]);
    // HitOrg: a due-this-week patient + an active admin + a deactivated admin + a specialist.
    await q(`insert into public.patients (org_id, name, status, next_due)
             values ($1,'P','verified', current_date + 2)`, [ORG_HIT]);
    await q(`insert into public.staff (org_id, name, email, role, deleted_at) values
             ($1,'Active','active@hit.com','admin', null),
             ($1,'Gone','gone@hit.com','admin', now()),
             ($1,'Spec','spec@hit.com','specialist', null)`, [ORG_HIT]);
    // NoAdminOrg: a signal but only a specialist (no admin recipient).
    await q(`insert into public.patients (org_id, name, status, next_due)
             values ($1,'Q','pending', null)`, [ORG_NOADMIN]);
    await q(`insert into public.staff (org_id, name, email, role) values ($1,'S','s@na.com','specialist')`, [ORG_NOADMIN]);
  });
});

afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.providers, public.patients, public.staff,
                          public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("runWeeklyDigest", () => {
  it("sends one digest per eligible org to active admins only; skips zero/no-admin orgs", async () => {
    const calls: Array<{ to: string[]; subject: string }> = [];
    const fakeSend = async (a: { to: string[]; subject: string; html: string; text: string }) => {
      calls.push({ to: a.to, subject: a.subject }); return { sent: true };
    };
    const summary = await runWeeklyDigest({ send: fakeSend, client: svc });
    expect(summary.orgsProcessed).toBe(3);
    expect(summary.digestsSent).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toEqual(["active@hit.com"]); // not the deactivated admin, not the specialist
    expect(calls[0].subject).toContain("HitOrg");
  });
});
