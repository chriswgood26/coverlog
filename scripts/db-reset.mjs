// Hosted-Supabase equivalent of `supabase db reset`.
// Drops and recreates the `public` schema (restoring the role grants Supabase
// applies by default), then applies every supabase/migrations/*.sql in order.
// Connects over SSL via SUPABASE_DB_URL (session-pooler connection).
//
// Usage: node scripts/db-reset.mjs   (or: npm run db:reset)
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvLocal() {
  const env = {};
  try {
    for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
  return env;
}

const env = loadEnvLocal();
const connectionString = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL is not set (check .env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  console.log("Resetting public schema…");
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.query(`
    grant usage on schema public to postgres, anon, authenticated, service_role;
    grant create on schema public to postgres;
    alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
  `);

  const dir = resolve(process.cwd(), "supabase/migrations");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    /* no migrations yet */
  }

  for (const f of files) {
    process.stdout.write(`Applying ${f} … `);
    await client.query(readFileSync(resolve(dir, f), "utf8"));
    console.log("ok");
  }

  console.log(`Done. Applied ${files.length} migration(s).`);
} catch (e) {
  console.error("db:reset FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
