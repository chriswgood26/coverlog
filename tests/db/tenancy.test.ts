import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeAll(async () => {
  await resetDb();
  await asAdmin(async (q) => {
    await q(`insert into public.organizations (id, name) values ($1,'Org A'),($2,'Org B')`, [ORG_A, ORG_B]);
    await q(
      `insert into public.staff (org_id, user_id, name, email, role)
       values ($1,$2,'Alice','a@a.com','admin'), ($3,$4,'Bob','b@b.com','admin')`,
      [ORG_A, USER_A, ORG_B, USER_B],
    );
  });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("tenant isolation", () => {
  it("user A sees only org A's staff", async () => {
    const rows = await withClaims(USER_A, async (q) => (await q(`select email from public.staff`)).rows);
    expect(rows.map((r: any) => r.email).sort()).toEqual(["a@a.com"]);
  });

  it("user B cannot see org A's organization row", async () => {
    const rows = await withClaims(USER_B, async (q) => (await q(`select name from public.organizations`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["Org B"]);
  });

  it("unauthenticated request sees nothing", async () => {
    const rows = await withClaims(null, async (q) => (await q(`select * from public.staff`)).rows);
    expect(rows).toEqual([]);
  });
});
