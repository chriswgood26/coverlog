import type { Pool } from "pg";

export type OnboardingInput = {
  userId: string; email: string; orgName: string; adminName: string;
};

// Atomically create the organization and its first admin staff row.
// Accepts a pg Pool (used directly with the privileged migration/service connection
// during onboarding, before the user has any org to scope to).
//
// Idempotent: if a non-deleted staff row already exists for `userId`, returns
// its existing orgId/staffId without creating a duplicate org or staff record.
export async function createOrgWithFirstAdmin(
  pool: Pool, input: OnboardingInput,
): Promise<{ orgId: string; staffId: string }> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    // Idempotency guard: check for an existing non-deleted staff row for this userId.
    const existing = await client.query(
      `select id, org_id from public.staff
       where user_id = $1 and deleted_at is null
       limit 1`,
      [input.userId],
    );
    if (existing.rows.length > 0) {
      await client.query("commit");
      return { orgId: existing.rows[0].org_id, staffId: existing.rows[0].id };
    }

    const org = await client.query(
      `insert into public.organizations (name) values ($1) returning id`, [input.orgName]);
    const orgId = org.rows[0].id;
    const staff = await client.query(
      `insert into public.staff (org_id, user_id, name, email, role)
       values ($1,$2,$3,$4,'admin') returning id`,
      [orgId, input.userId, input.adminName, input.email]);
    await client.query("commit");
    return { orgId, staffId: staff.rows[0].id };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
