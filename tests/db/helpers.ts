import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

// Run `fn` inside a transaction as the `authenticated` role with the JWT claims
// Supabase RLS reads. Passing null simulates an unauthenticated request.
export async function withClaims<T>(
  userId: string | null,
  fn: (q: (text: string, params?: unknown[]) => Promise<any>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    const claims = userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "{}";
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    const q = (text: string, params?: unknown[]) => client.query(text, params);
    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// Seed helper runs as the superuser (RLS bypassed) to set up fixtures.
export async function asAdmin<T>(fn: (q: (t: string, p?: unknown[]) => Promise<any>) => Promise<T>) {
  const client = await pool.connect();
  try {
    const q = (text: string, params?: unknown[]) => client.query(text, params);
    return await fn(q);
  } finally {
    client.release();
  }
}

export async function resetDb() {
  await asAdmin(async (q) => {
    await q(`truncate table public.staff, public.organizations restart identity cascade`);
  });
}
