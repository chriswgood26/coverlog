import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A'),($2,'B')`, [ORG_A, ORG_B]);
    await q(`insert into public.staff (org_id, user_id, name, email, role) values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
    // Org A: 1 verified today, 1 due in 3 days (pending), 1 inactive; Org B: noise that must not count.
    await q(`insert into public.patients (org_id, name, status, last_checked, next_due) values
             ($1,'V','verified',current_date, current_date+30),
             ($1,'D','pending', current_date-10, current_date+3),
             ($1,'I','inactive', null, null)`, [ORG_A]);
    await q(`insert into public.patients (org_id, name, status, last_checked, next_due) values
             ($1,'BX','verified',current_date, current_date+1)`, [ORG_B]);
  });
});

afterAll(async () => { await resetDb(); await pool.end(); });

describe("dashboard stat SQL (RLS-scoped)", () => {
  it("counts only the caller's org", async () => {
    const stats = await withClaims(USER_A, async (q) => ({
      verifiedToday: Number((await q(`select count(*) c from public.patients where deleted_at is null and status='verified' and last_checked=current_date`)).rows[0].c),
      dueThisWeek: Number((await q(`select count(*) c from public.patients where deleted_at is null and next_due between current_date and current_date+7`)).rows[0].c),
      needsAttention: Number((await q(`select count(*) c from public.patients where deleted_at is null and status in ('pending','inactive')`)).rows[0].c),
    }));
    expect(stats).toEqual({ verifiedToday: 1, dueThisWeek: 1, needsAttention: 2 });
  });
});
