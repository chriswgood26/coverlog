// Vitest setup: load .env.local into process.env so DB-backed tests can read
// SUPABASE_DB_URL etc. Hand-parsed (no dependency). Existing env vars win.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env.local is optional (e.g. CI without a configured DB).
}
