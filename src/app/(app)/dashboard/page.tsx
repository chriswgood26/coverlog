import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { getDashboardStats, getCredentialingStats } from "@/lib/dashboard/stats";
import { listPendingVerifications } from "@/lib/phi/access";
import { listExpiringCredentials } from "@/lib/providers/queries";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

function daysLabel(dateStr: string): string {
  const d = Math.ceil((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86_400_000);
  if (d < 0) return `${-d} day${-d === 1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  return `${d} day${d === 1 ? "" : "s"} left`;
}

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  const [stats, cred, me, pending, expiring] = await Promise.all([
    getDashboardStats(supabase),
    getCredentialingStats(supabase),
    ctx ? supabase.from("staff").select("name").eq("id", ctx.staffId).maybeSingle() : Promise.resolve({ data: null }),
    ctx ? listPendingVerifications(supabase, ctx) : Promise.resolve([]),
    listExpiringCredentials(supabase),
  ]);
  const name = (me.data as { name?: string } | null)?.name ?? "there";
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const credCards = [
    { label: "Total Providers", value: cred.totalProviders, tint: "bg-teal-50 border-teal-100" },
    { label: "Expiring Soon", value: cred.licensesExpiring, tint: "bg-amber-50 border-amber-100" },
    { label: "Pending Review", value: cred.pendingReview, tint: "bg-blue-50 border-blue-100" },
    { label: "Flagged", value: cred.flagged, tint: "bg-red-50 border-red-100" },
  ];
  const eligCards = [
    { label: "Verified today", value: stats.verifiedToday, tint: "bg-emerald-50 border-emerald-100" },
    { label: "Due this week", value: stats.dueThisWeek, tint: "bg-teal-50 border-teal-100" },
    { label: "Needs attention", value: stats.needsAttention, tint: "bg-amber-50 border-amber-100" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Good {part}, {name}</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {pending.length} eligibility verification{pending.length === 1 ? "" : "s"} pending · {cred.licensesExpiring} credential{cred.licensesExpiring === 1 ? "" : "s"} expiring soon
        </p>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Credentialing</div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {credCards.map((c) => (
            <div key={c.label} className={`${c.tint} border rounded-2xl p-5`}>
              <div className="text-3xl font-bold text-slate-900">{c.value}</div>
              <div className="text-sm text-slate-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Eligibility</div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {eligCards.map((c) => (
            <div key={c.label} className={`${c.tint} border rounded-2xl p-5`}>
              <div className="text-3xl font-bold text-slate-900">{c.value}</div>
              <div className="text-sm text-slate-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pending Verifications">
          {pending.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">No pending verifications.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {pending.map((p) => (
                <Link key={p.id} href={`/patients/${p.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.primary_payer ?? "—"}{p.member_id ? ` · ${p.member_id}` : ""}</div>
                  </div>
                  <Badge value="pending" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Expiring Credentials">
          {expiring.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">No credentials expiring.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {expiring.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{e.name}</div>
                    <div className="text-xs text-slate-500">{e.license_type ?? "License"}</div>
                  </div>
                  <span className="text-xs font-medium text-amber-700">{daysLabel(e.license_expiration)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
