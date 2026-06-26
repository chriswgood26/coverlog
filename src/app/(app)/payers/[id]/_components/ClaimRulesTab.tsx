import type { ResolvedClaimRule } from "@/lib/payers/resolve";
import { saveOrgClaimRuleAction } from "../../actions";

export function ClaimRulesTab({ rows, payerMasterId, payerDirectoryId }:
  { rows: ResolvedClaimRule[]; payerMasterId: string | null; payerDirectoryId: string }) {
  return (
    <section>
      <h2 className="font-medium">Claim Rules</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Category</th><th>Field</th><th>Rule</th><th>Required</th><th>Source</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b">
              <td className="p-2">{r.rule_category ?? "—"}</td><td>{r.field_reference ?? "—"}</td>
              <td>{r.rule_description ?? "—"}</td><td>{r.required_value ?? "—"}</td>
              <td><span className={r.provenance === "org" ? "text-blue-700" : "text-gray-500"}>
                {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {payerMasterId && (
        <form action={saveOrgClaimRuleAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="payerMasterId" value={payerMasterId} />
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <input name="ruleCategory" required placeholder="Category (e.g. modifier)" className="border p-1" />
          <input name="fieldReference" placeholder="Box 24J" className="border p-1 w-24" />
          <input name="ruleDescription" placeholder="Rule" className="border p-1" />
          <input name="requiredValue" placeholder="Required value" className="border p-1" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Save override</button>
        </form>
      )}
    </section>
  );
}
