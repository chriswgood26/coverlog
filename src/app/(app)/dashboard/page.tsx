import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { getDashboardStats, getCredentialingStats } from "@/lib/dashboard/stats";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  const [stats, cred, me] = await Promise.all([
    getDashboardStats(supabase),
    getCredentialingStats(supabase),
    ctx ? supabase.from("staff").select("name").eq("id", ctx.staffId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const name = (me.data as { name?: string } | null)?.name ?? "there";
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const cards: { label: string; value: number; tint: string }[] = [
    { label: "Verified today", value: stats.verifiedToday, tint: "bg-emerald-50 border-emerald-100" },
    { label: "Due this week", value: stats.dueThisWeek, tint: "bg-teal-50 border-teal-100" },
    { label: "Needs attention", value: stats.needsAttention, tint: "bg-amber-50 border-amber-100" },
    { label: "Licenses expiring soon", value: cred.licensesExpiring, tint: "bg-blue-50 border-blue-100" },
    { label: "Enrollments due for revalidation", value: cred.revalidationsDue, tint: "bg-red-50 border-red-100" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Good {part}, {name}</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {stats.dueThisWeek} due this week · {stats.needsAttention} need attention · {cred.licensesExpiring} licenses expiring soon
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className={`${c.tint} border rounded-2xl p-5`}>
            <div className="text-3xl font-bold text-slate-900">{c.value}</div>
            <div className="text-sm text-slate-500 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
