import type { EnrollmentRow, Provider } from "@/lib/providers/queries";
import { saveEnrollmentAction } from "../../actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, btnPrimary, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export function EnrolledProvidersTab({ rows, providers, payerDirectoryId, isAdmin }:
  { rows: EnrollmentRow[]; providers: Provider[]; payerDirectoryId: string; isAdmin: boolean }) {
  return (
    <Card title="Enrolled Providers">
      <table className="w-full">
        <thead><tr className={theadRow}><th className={thCell}>Provider</th><th className={thCell}>Status</th><th className={thCell}>PAR</th><th className={thCell}>Effective</th><th className={thCell}>Revalidation</th><th className={thCell}>CAQH</th></tr></thead>
        <tbody className={tbody}>
          {rows.map((r) => (
            <tr key={r.id} className={rowHover}>
              <td className="px-4 py-4 text-sm text-slate-900">{r.provider_name}</td>
              <td className="px-4 py-4"><Badge value={r.status} /></td>
              <td className="px-4 py-4">{r.par_status ? <Badge value={r.par_status} /> : <span className="text-sm text-slate-400">—</span>}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.effective_date ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.revalidation_due ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600 font-mono">{r.caqh_id ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && providers.length > 0 && (
        <form action={saveEnrollmentAction} className="flex flex-wrap gap-2 px-5 py-4 border-t border-slate-100">
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <select name="providerId" required className={`${inputClass} w-auto`}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="status" className={`${inputClass} w-auto`}>
            <option value="pending">pending</option><option value="enrolled">enrolled</option>
            <option value="terminated">terminated</option><option value="not_enrolled">not enrolled</option>
          </select>
          <select name="parStatus" className={`${inputClass} w-auto`}>
            <option value="">PAR —</option><option value="in_network">in network</option>
            <option value="out_of_network">out of network</option>
          </select>
          <input name="effectiveDate" type="date" className={`${inputClass} w-auto`} />
          <input name="revalidationDue" type="date" className={`${inputClass} w-auto`} />
          <input name="terminationDate" type="date" className={`${inputClass} w-auto`} />
          <input name="caqhId" placeholder="CAQH ID" className={`${inputClass} w-28`} />
          <button className={btnPrimary}>Save enrollment</button>
        </form>
      )}
    </Card>
  );
}
