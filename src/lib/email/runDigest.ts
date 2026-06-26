import { createServiceSupabase } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/ses";
import { buildOrgDigest, shouldSendDigest, type AlertCounts } from "@/lib/email/digest";

type SendFn = (a: { to: string[]; subject: string; html: string; text: string }) => Promise<{ sent: boolean; skipped?: boolean }>;
type ServiceClient = ReturnType<typeof createServiceSupabase>;
export type DigestSummary = { orgsProcessed: number; digestsSent: number; skipped: number };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://coverlog.app";

export async function runWeeklyDigest(
  opts: { send?: SendFn; client?: ServiceClient } = {},
): Promise<DigestSummary> {
  const send = opts.send ?? sendEmail;
  const client = opts.client ?? createServiceSupabase();

  const { data: orgs, error } = await client.from("organizations").select("id, name");
  if (error) throw new Error(`runWeeklyDigest failed: ${error.message}`);

  let digestsSent = 0;
  let skipped = 0;
  for (const org of (orgs ?? []) as Array<{ id: string; name: string }>) {
    const { data: countRows, error: cErr } = await client.rpc("org_alert_counts", { p_org_id: org.id });
    if (cErr) throw new Error(`org_alert_counts failed: ${cErr.message}`);
    const r = ((countRows ?? []) as any[])[0] ?? {};
    const counts: AlertCounts = {
      licensesExpiring: Number(r.licenses_expiring ?? 0),
      revalidationsDue: Number(r.revalidations_due ?? 0),
      consentsExpiring: Number(r.consents_expiring ?? 0),
      dueThisWeek: Number(r.due_this_week ?? 0),
      needsAttention: Number(r.needs_attention ?? 0),
    };

    const { data: admins, error: aErr } = await client.from("staff")
      .select("email").eq("org_id", org.id).eq("role", "admin").is("deleted_at", null);
    if (aErr) throw new Error(`runWeeklyDigest admins failed: ${aErr.message}`);
    const to = ((admins ?? []) as Array<{ email: string | null }>)
      .map((a) => a.email).filter((e): e is string => Boolean(e));

    if (!shouldSendDigest(counts) || to.length === 0) { skipped++; continue; }
    const { subject, html, text } = buildOrgDigest(org.name, counts, APP_URL);
    await send({ to, subject, html, text });
    digestsSent++;
  }
  return { orgsProcessed: (orgs ?? []).length, digestsSent, skipped };
}
