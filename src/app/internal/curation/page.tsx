import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { listMasterPayers } from "@/lib/payers/curation";
import { addMasterPayerAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { tableWrap, theadRow, thCell, tbody, rowHover, inputClass, labelClass, btnPrimary } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function CurationPage() {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const payers = await listMasterPayers(createServiceSupabase());
  return (
    <div className="space-y-4">
      <PageHeader title="Payer Curation" subtitle={`${payers.length} master payers`} backHref="/internal" />
      <Card title="Add master payer">
        <form action={addMasterPayerAction} className="p-5 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className={labelClass}>Name</label>
            <input name="name" required className={inputClass} placeholder="e.g. Aetna" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className={labelClass}>Type</label>
            <input name="payerType" className={inputClass} placeholder="commercial / medicaid …" />
          </div>
          <button className={btnPrimary}>Add payer</button>
        </form>
      </Card>
      {payers.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">No master payers yet.</div>
      ) : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Type</th></tr></thead>
            <tbody className={tbody}>
              {payers.map((p) => (
                <tr key={p.id} className={rowHover}>
                  <td className="px-4 py-4"><Link href={`/internal/curation/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-teal-600">{p.name}</Link></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.payer_type ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
