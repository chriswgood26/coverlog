export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listOrgConsents } from "@/lib/phi/access";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export default async function AdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const consents = await listOrgConsents(supabase, ctx);
  return (
    <div className="space-y-4">
      <PageHeader title="Admin">
        <Link href="/admin/staff" className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm">Staff</Link>
        <Link href="/admin/audit" className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm">Audit Log</Link>
      </PageHeader>
      <Card title="Consents">
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Patient</th><th className={thCell}>Type</th><th className={thCell}>Granted</th><th className={thCell}>Expires</th><th className={thCell}>Status</th></tr></thead>
          <tbody className={tbody}>
            {consents.map((c) => (
              <tr key={c.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{c.patient_name}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.consent_type}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.granted_at?.slice(0, 10) ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.expires_at?.slice(0, 10) ?? "—"}</td>
                <td className="px-4 py-4"><Badge value={c.revoked_at ? "revoked" : "active"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
