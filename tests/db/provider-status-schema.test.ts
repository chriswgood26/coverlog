import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, resetDb } from "./helpers";

const ORG = "11111111-1111-1111-1111-111111111111";

beforeAll(async () => {
  await asAdmin(async (q) => {
    await q(`truncate table public.providers, public.organizations restart identity cascade`);
    await q(`insert into public.organizations (id, name) values ($1,'A')`, [ORG]);
  });
});
afterAll(async () => {
  await asAdmin((q) => q(`truncate table public.providers, public.organizations restart identity cascade`));
  await resetDb();
  await pool.end();
});

describe("providers.status / specialty schema", () => {
  it("defaults status to 'active' and stores specialty", async () => {
    const row = await asAdmin(async (q) =>
      (await q(`insert into public.providers (org_id, name, specialty) values ($1,'Dr A','Cardiology')
                returning status, specialty`, [ORG])).rows[0]);
    expect(row.status).toBe("active");
    expect(row.specialty).toBe("Cardiology");
  });

  it("rejects an invalid status via the check constraint", async () => {
    await expect(
      asAdmin((q) => q(`insert into public.providers (org_id, name, status) values ($1,'Dr B','bogus')`, [ORG])),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("accepts the three valid statuses", async () => {
    await asAdmin((q) => q(`insert into public.providers (org_id, name, status) values
      ($1,'Dr P','pending'),($1,'Dr F','flagged'),($1,'Dr Ac','active')`, [ORG]));
    const rows = await asAdmin(async (q) =>
      (await q(`select status from public.providers where org_id=$1 and name in ('Dr P','Dr F','Dr Ac') order by name`, [ORG])).rows);
    expect(rows.map((r: any) => r.status).sort()).toEqual(["active", "flagged", "pending"]);
  });
});
