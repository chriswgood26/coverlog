import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.access_log, public.disclosure_log, public.patient_consents,
             public.patients, public.staff, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'Org A')`, [ORG_A]);
    await q(`insert into public.staff (org_id, user_id, name, email, role)
             values ($1,$2,'Alice','a@a.com','admin')`, [ORG_A, USER_A]);
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("access_log append-only", () => {
  it("user A can insert and read an access_log row", async () => {
    const rows = await withClaims(USER_A, async (q) => {
      await q(`insert into public.access_log (org_id, action, query_context, occurred_at)
               values ($1,'patient_search','name=smith', now())`, [ORG_A]);
      return (await q(`select action from public.access_log`)).rows;
    });
    expect(rows.map((r: any) => r.action)).toEqual(["patient_search"]);
  });

  it("user A cannot update an access_log row (no update policy)", async () => {
    await expect(
      withClaims(USER_A, async (q) =>
        q(`update public.access_log set action='tampered' where org_id=$1`, [ORG_A]),
      ),
    ).rejects.toThrow(/row-level security|permission/i);
  });
});
