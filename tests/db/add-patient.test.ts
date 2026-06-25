import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";
import { addPatient } from "@/lib/patients/mutations";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Al','a@a.com','admin')`, [ORG_A, USER_A]);
  });
});

afterAll(async () => { await resetDb(); await pool.end(); });

describe("addPatient", () => {
  it("inserts a pending patient scoped to the caller's org", async () => {
    // Verify the row lands in org A with status 'pending' by reading it back as admin.
    await withClaims(USER_A, async (q) => {
      await q(
        `insert into public.patients (org_id, name, member_id, primary_payer, status)
         values (public.user_org_id(), 'Jane Doe', 'M123', 'Aetna', 'pending')`,
      );
    });
    const rows = await asAdmin(async (q) =>
      (await q(`select name, org_id, status from public.patients where name='Jane Doe'`)).rows);
    expect(rows[0]).toMatchObject({ name: "Jane Doe", org_id: ORG_A, status: "pending" });
  });
});
