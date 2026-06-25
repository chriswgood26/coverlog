import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, asAdmin, withClaims, resetDb } from "./helpers";
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

  it("calling createOrgWithFirstAdmin twice with the same userId returns the same orgId and does NOT create a second org", async () => {
    // First call already ran above; call again with same userId.
    const { orgId: orgId2, staffId: staffId2 } = await createOrgWithFirstAdmin(pool, {
      userId: USER_NEW,
      email: "new@clinic.com",
      orgName: "Duplicate Clinic",  // different name to prove idempotency ignores this
      adminName: "Dana",
    });

    // Should return the SAME orgId as the first call.
    const firstResult = await asAdmin(async (q) =>
      (await q(`select id, org_id from public.staff where user_id = $1 and deleted_at is null`, [USER_NEW])).rows
    );
    expect(firstResult).toHaveLength(1);  // only one staff row for this user
    expect(orgId2).toBe(firstResult[0].org_id);
    expect(staffId2).toBe(firstResult[0].id);

    // Only ONE org should exist for this user.
    const orgs = await asAdmin(async (q) =>
      (await q(`select count(*)::int as n from public.organizations where id = $1`, [orgId2])).rows
    );
    expect(orgs[0].n).toBe(1);

    // The org name should be "New Clinic" (the original), not "Duplicate Clinic".
    const orgName = await asAdmin(async (q) =>
      (await q(`select name from public.organizations where id = $1`, [orgId2])).rows
    );
    expect(orgName[0].name).toBe("New Clinic");
  });
});
