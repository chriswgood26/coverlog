import type { ResolvedCoverage } from "@/lib/payers/resolve";
import { saveOrgCoverageAction } from "../../actions";
import { Card } from "@/components/ui/Card";
import { inputClass, btnPrimary, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export function CoveredCodesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedCoverage[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <Card title="Covered Codes">
      <table className="w-full">
        <thead><tr className={theadRow}><th className={thCell}>CPT</th><th className={thCell}>Covered</th><th className={thCell}>Prior auth</th><th className={thCell}>Modifier</th><th className={thCell}>Source</th></tr></thead>
        <tbody className={tbody}>
          {rows.map((r) => (
            <tr key={r.cpt_code} className={rowHover}>
              <td className="px-4 py-4 text-sm text-slate-900 font-mono">{r.cpt_code}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.covered ? "Yes" : "No"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.requires_prior_auth ? "Yes" : "No"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.modifier_required ?? "—"}</td>
              <td className="px-4 py-4">
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.provenance === "org" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                  {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgCoverageAction} className="flex flex-wrap items-center gap-2 px-5 py-4 border-t border-slate-100">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="cptCode" required placeholder="CPT" className={`${inputClass} w-24`} />
          <label className="text-sm text-slate-600 flex items-center gap-1"><input type="checkbox" name="covered" defaultChecked /> covered</label>
          <label className="text-sm text-slate-600 flex items-center gap-1"><input type="checkbox" name="requiresPriorAuth" /> prior auth</label>
          <input name="modifierRequired" placeholder="Modifier" className={`${inputClass} w-24`} />
          <button className={btnPrimary}>Save override</button>
        </form>
      )}
    </Card>
  );
}
