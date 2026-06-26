import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { listBaselineCoverage, listBaselineClaimRules } from "@/lib/payers/curation";
import { addBaselineCoverageAction, addBaselineClaimRuleAction } from "../actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { theadRow, thCell, tbody, rowHover, inputClass, labelClass, btnPrimary } from "@/lib/ui";

export const dynamic = "force-dynamic";

const yn = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "—");

export default async function CurationDetailPage({ params }: { params: Promise<{ payerId: string }> }) {
  const { payerId } = await params;
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const svc = createServiceSupabase();
  const { data: payer } = await svc.from("payer_master").select("name").eq("id", payerId).maybeSingle();
  if (!payer) notFound();
  const coverage = await listBaselineCoverage(svc, payerId);
  const rules = await listBaselineClaimRules(svc, payerId);
  return (
    <div className="space-y-4">
      <PageHeader title={(payer as { name: string }).name} subtitle="Baseline curation" backHref="/internal/curation" />

      <Card title="Baseline coverage">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className={theadRow}>
              <th className={thCell}>CPT</th><th className={thCell}>Covered</th><th className={thCell}>Prior auth</th>
              <th className={thCell}>Telehealth</th><th className={thCell}>Modifier</th><th className={thCell}>Unit limit</th><th className={thCell}>Notes</th>
            </tr></thead>
            <tbody className={tbody}>
              {coverage.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No baseline coverage yet.</td></tr>
              ) : coverage.map((r) => (
                <tr key={r.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{r.cpt_code}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{yn(r.covered)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{yn(r.requires_prior_auth)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{yn(r.telehealth_allowed)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.modifier_required ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.unit_limit ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={addBaselineCoverageAction} className="p-5 border-t border-slate-100 flex flex-wrap items-end gap-3">
          <input type="hidden" name="payerMasterId" value={payerId} />
          <div className="w-28"><label className={labelClass}>CPT</label><input name="cptCode" required className={inputClass} placeholder="90834" /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5"><input type="checkbox" name="covered" defaultChecked /> Covered</label>
          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5"><input type="checkbox" name="requiresPriorAuth" /> Prior auth</label>
          <div className="w-28"><label className={labelClass}>Telehealth</label>
            <select name="telehealthAllowed" className={inputClass}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></div>
          <div className="w-28"><label className={labelClass}>Modifier</label><input name="modifierRequired" className={inputClass} placeholder="95" /></div>
          <div className="w-28"><label className={labelClass}>Unit limit</label><input name="unitLimit" className={inputClass} /></div>
          <div className="flex-1 min-w-[160px]"><label className={labelClass}>Notes</label><input name="notes" className={inputClass} /></div>
          <button type="submit" className={btnPrimary}>Save coverage</button>
          <p className="w-full text-xs text-slate-400">Re-submitting an existing key replaces that baseline row.</p>
        </form>
      </Card>

      <Card title="Baseline claim rules">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className={theadRow}>
              <th className={thCell}>Category</th><th className={thCell}>Field</th><th className={thCell}>Required value</th><th className={thCell}>Description</th><th className={thCell}>Notes</th>
            </tr></thead>
            <tbody className={tbody}>
              {rules.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No baseline claim rules yet.</td></tr>
              ) : rules.map((r) => (
                <tr key={r.id} className={rowHover}>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{r.rule_category ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.field_reference ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.required_value ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.rule_description ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={addBaselineClaimRuleAction} className="p-5 border-t border-slate-100 flex flex-wrap items-end gap-3">
          <input type="hidden" name="payerMasterId" value={payerId} />
          <div className="w-40"><label className={labelClass}>Category</label><input name="ruleCategory" required className={inputClass} placeholder="timely_filing" /></div>
          <div className="w-32"><label className={labelClass}>Field</label><input name="fieldReference" className={inputClass} /></div>
          <div className="w-40"><label className={labelClass}>Required value</label><input name="requiredValue" className={inputClass} /></div>
          <div className="flex-1 min-w-[160px]"><label className={labelClass}>Description</label><input name="ruleDescription" className={inputClass} /></div>
          <div className="flex-1 min-w-[120px]"><label className={labelClass}>Notes</label><input name="notes" className={inputClass} /></div>
          <button type="submit" className={btnPrimary}>Save rule</button>
          <p className="w-full text-xs text-slate-400">Re-submitting an existing key replaces that baseline row.</p>
        </form>
      </Card>
    </div>
  );
}
