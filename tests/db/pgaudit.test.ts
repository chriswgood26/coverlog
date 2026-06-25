import { describe, it, expect, afterAll } from "vitest";
import { pool, asAdmin } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("pgaudit backstop", () => {
  it("pgaudit extension is installed", async () => {
    const rows = await asAdmin(async (q) =>
      (await q(`select extname from pg_extension where extname = 'pgaudit'`)).rows);
    expect(rows.length).toBe(1);
  });

  // On hosted Supabase the `postgres` role is not the database owner, so
  // `ALTER DATABASE ... SET pgaudit.log` is denied. The migration uses the
  // role-scoped form (`ALTER ROLE authenticated SET pgaudit.log = ...`), which
  // stores the setting in pg_db_role_setting rather than pg_settings.
  // This test verifies the role-level setting is present there.
  it("authenticated role is configured to log reads", async () => {
    const rows = await asAdmin(async (q) =>
      (await q(`
        select rs.setconfig
        from pg_db_role_setting rs
        join pg_roles r on r.oid = rs.setrole
        where r.rolname = 'authenticated'
          and rs.setdatabase = 0
      `)).rows);
    // setconfig is a text[] of "key=value" entries; find the pgaudit.log entry.
    const allConfig = (rows[0]?.setconfig ?? []) as string[];
    const pgauditEntry = allConfig.find((c) => c.startsWith("pgaudit.log="));
    expect(pgauditEntry).toBeDefined();
    expect(pgauditEntry).toMatch(/read/);
  });
});
