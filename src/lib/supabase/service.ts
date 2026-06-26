import { createClient } from "@supabase/supabase-js";

// Service-role client — BYPASSES RLS. Internal curation / admin use ONLY.
// NEVER import this from a tenant-facing page, server action, or component.
export function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
