export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/PageHeader";
import { tableWrap, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export default async function PayersPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const { data: payers } = await supabase
    .from("payer_directory")
    .select("id, payer_name, portal_url, payer_master_id")
    .order("payer_name");
  return (
    <div className="space-y-4">
      <PageHeader title="Insurance Credentialing" subtitle={`${(payers ?? []).length} total`} />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Payer</th><th className={thCell}>Portal</th><th className={thCell}>Linked</th></tr></thead>
          <tbody className={tbody}>
            {(payers ?? []).map((p: any) => (
              <tr key={p.id} className={rowHover}>
                <td className="px-4 py-4"><Link href={`/payers/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-teal-600">{p.payer_name}</Link></td>
                <td className="px-4 py-4 text-sm">{p.portal_url ? <a href={p.portal_url} target="_blank" rel="noreferrer" className="text-teal-600 hover:text-teal-700 font-medium">Open portal</a> : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-4 text-sm">{p.payer_master_id ? <span className="text-emerald-600">✓</span> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
