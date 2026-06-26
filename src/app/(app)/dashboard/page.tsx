import { createServerSupabase } from "@/lib/supabase/server";
import { getDashboardStats, getCredentialingStats } from "@/lib/dashboard/stats";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const [stats, cred] = await Promise.all([
    getDashboardStats(supabase),
    getCredentialingStats(supabase),
  ]);
  const cards = [
    { label: "Verified today", value: stats.verifiedToday },
    { label: "Due this week", value: stats.dueThisWeek },
    { label: "Needs attention", value: stats.needsAttention },
    { label: "Licenses expiring soon", value: cred.licensesExpiring },
    { label: "Enrollments due for revalidation", value: cred.revalidationsDue },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border p-6">
          <div className="text-3xl font-semibold">{c.value}</div>
          <div className="text-sm text-gray-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
