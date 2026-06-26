import { cronAuthorized } from "@/lib/cron/auth";
import { createServiceSupabase } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const { data, error } = await createServiceSupabase()
    .rpc("ensure_upcoming_access_log_partitions", { p_months: 6 });
  if (error) return new Response(`partition ensure failed: ${error.message}`, { status: 500 });
  return Response.json({ ensured: data });
}
