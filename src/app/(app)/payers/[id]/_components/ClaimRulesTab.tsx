import type { ResolvedClaimRule } from "@/lib/payers/resolve";
import { saveOrgClaimRuleAction } from "../../actions";
import { Card } from "@/components/ui/Card";
import { inputClass, btnPrimary, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export function ClaimRulesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedClaimRule[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <Card title="Claim Rules">
      <table className="w-full">
        <thead><tr className={theadRow}><th className={thCell}>Category</th><th className={thCell}>Field</th><th className={thCell}>Rule</th><th className={thCell}>Required</th><th className={thCell}>Source</th></tr></thead>
        <tbody className={tbody}>
          {rows.map((r, i) => (
            <tr key={i} className={rowHover}>
              <td className="px-4 py-4 text-sm text-slate-900">{r.rule_category ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.field_reference ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.rule_description ?? "—"}</td>
              <td className="px-4 py-4 text-sm text-slate-600">{r.required_value ?? "—"}</td>
              <td className="px-4 py-4">
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.provenance === "org" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                  {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgClaimRuleAction} className="flex flex-wrap gap-2 px-5 py-4 border-t border-slate-100">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="ruleCategory" required placeholder="Category (e.g. modifier)" className={`${inputClass} w-auto`} />
          <input name="fieldReference" placeholder="Box 24J" className={`${inputClass} w-28`} />
          <input name="ruleDescription" placeholder="Rule" className={`${inputClass} w-auto`} />
          <input name="requiredValue" placeholder="Required value" className={`${inputClass} w-auto`} />
          <button className={btnPrimary}>Save override</button>
        </form>
      )}
    </Card>
  );
}
