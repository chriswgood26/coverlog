import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, withClaims, resetDb } from "./helpers";
import { createOrgWithFirstAdmin } from "@/lib/onboarding";

const USER_NEW = "cccccccc-cccc-cccc-cccc-cccccccccccc";

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe("onboarding", () => {
  it("creates an org + admin staff that resolves via public.user_org_id()", async () => {
    const { orgId } = await createOrgWithFirstAdmin(pool, {
      userId: USER_NEW, email: "new@clinic.com", orgName: "New Clinic", adminName: "Dana",
    });
    expect(orgId).toBeTruthy();
    // The new user now sees exactly their own org via RLS.
    const rows = await withClaims(USER_NEW, async (q) =>
      (await q(`select name from public.organizations`)).rows);
    expect(rows.map((r: any) => r.name)).toEqual(["New Clinic"]);
  });
});
