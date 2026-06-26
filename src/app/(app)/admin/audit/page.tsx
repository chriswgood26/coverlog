export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listAuditTrail } from "@/lib/phi/access";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { theadRow, thCell, tbody, rowHover } from "@/lib/ui";

function fmt(ts: string): string {
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function AuditLogPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const trail = await listAuditTrail(supabase, ctx);

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" subtitle="Most recent events" backHref="/admin" />

      <Card title="Access Log">
        {trail.access.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No access events.</div>
        ) : (
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>When</th><th className={thCell}>Actor</th><th className={thCell}>Action</th><th className={thCell}>Patient(s)</th></tr></thead>
            <tbody className={tbody}>
              {trail.access.map((e) => (
                <tr key={e.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmt(e.occurred_at)}</td>
                  <td className="px-4 py-3 text-sm text-slate-900">{e.actor_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.action.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-sm">
                    {e.patient_id
                      ? <Link href={`/patients/${e.patient_id}`} className="text-teal-600 hover:text-teal-700 font-medium">{e.patient_label}</Link>
                      : <span className="text-slate-600">{e.patient_label}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Disclosure Log">
        {trail.disclosures.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No disclosures.</div>
        ) : (
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>When</th><th className={thCell}>Actor</th><th className={thCell}>Action</th><th className={thCell}>Patient</th><th className={thCell}>Purpose</th><th className={thCell}>Disclosed to</th></tr></thead>
            <tbody className={tbody}>
              {trail.disclosures.map((e) => (
                <tr key={e.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmt(e.occurred_at)}</td>
                  <td className="px-4 py-3 text-sm text-slate-900">{e.actor_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.action.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-sm">
                    {e.patient_id
                      ? <Link href={`/patients/${e.patient_id}`} className="text-teal-600 hover:text-teal-700 font-medium">{e.patient_name}</Link>
                      : <span className="text-slate-600">{e.patient_name}</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.purpose ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{e.disclosed_to ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
