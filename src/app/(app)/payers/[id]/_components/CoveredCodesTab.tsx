import type { ResolvedCoverage } from "@/lib/payers/resolve";
import { saveOrgCoverageAction } from "../../actions";

export function CoveredCodesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedCoverage[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <section>
      <h2 className="font-medium">Covered Codes</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">CPT</th><th>Covered</th><th>Prior auth</th><th>Modifier</th><th>Source</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cpt_code} className="border-b">
              <td className="p-2">{r.cpt_code}</td><td>{r.covered ? "Yes" : "No"}</td>
              <td>{r.requires_prior_auth ? "Yes" : "No"}</td><td>{r.modifier_required ?? "—"}</td>
              <td><span className={r.provenance === "org" ? "text-blue-700" : "text-gray-500"}>
                {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgCoverageAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="cptCode" required placeholder="CPT" className="border p-1 w-24" />
          <label className="text-sm"><input type="checkbox" name="covered" defaultChecked /> covered</label>
          <label className="text-sm"><input type="checkbox" name="requiresPriorAuth" /> prior auth</label>
          <input name="modifierRequired" placeholder="Modifier" className="border p-1 w-24" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Save override</button>
        </form>
      )}
    </section>
  );
}
