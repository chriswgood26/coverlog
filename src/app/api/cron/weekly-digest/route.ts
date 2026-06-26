import { cronAuthorized } from "@/lib/cron/auth";
import { runWeeklyDigest } from "@/lib/email/runDigest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const summary = await runWeeklyDigest();
  return Response.json(summary);
}
