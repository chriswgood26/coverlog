import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { readPatient, listCheckHistory } from "@/lib/phi/access";
import { hasValidConsent, listConsentsForPatient } from "@/lib/phi/consent";
import { redirect, notFound } from "next/navigation";
import { LogCheckDrawer } from "../_components/LogCheckDrawer";
import { resolveCoverage } from "@/lib/payers/resolve";
import { linkPatientPayerAction, grantConsentAction, revokeConsentAction } from "../actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { inputClass, btnPrimary, btnDangerText, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patient = await readPatient(supabase, ctx, id);
  if (!patient) notFound();
  const [history, consent, orgPayersRes, consents] = await Promise.all([
    listCheckHistory(supabase, ctx, id),
    hasValidConsent(supabase, id),
    supabase.from("payer_directory").select("id, payer_name, payer_master_id").order("payer_name"),
    listConsentsForPatient(supabase, id),
  ]);
  const orgPayers = orgPayersRes.data;
  const payerDirId = (patient as any).primary_payer_directory_id as string | null;
  const linked = payerDirId ? (orgPayers ?? []).find((p: any) => p.id === payerDirId) : null;
  const coverage = linked?.payer_master_id
    ? await resolveCoverage(supabase, linked.payer_master_id as string)
    : [];
  return (
    <div className="space-y-6">
      <PageHeader title={patient.name as string} backHref="/patients" />
      {!consent && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          No valid 42 CFR Part 2 consent on file — disclosure/export is blocked for this patient.
        </div>
      )}
      <LogCheckDrawer patientId={id} />

      <Card title="Primary payer coverage">
        <div className="p-5 space-y-3">
          <form action={linkPatientPayerAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="patientId" value={id} />
            <select name="payerDirectoryId" defaultValue={payerDirId ?? ""} className={`${inputClass} w-auto`}>
              <option value="">— not linked —</option>
              {(orgPayers ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.payer_name}</option>)}
            </select>
            <button className={btnPrimary}>Link payer</button>
          </form>
          {linked && !linked.payer_master_id && (
            <p className="text-sm text-amber-700">Linked payer isn&apos;t mapped to a canonical payer yet — no baseline coverage to show.</p>
          )}
          {coverage.length > 0 && (
            <table className="w-full">
              <thead><tr className={theadRow}><th className={thCell}>CPT</th><th className={thCell}>Covered</th><th className={thCell}>Prior auth</th><th className={thCell}>Source</th></tr></thead>
              <tbody className={tbody}>
                {coverage.map((r) => (
                  <tr key={r.cpt_code} className={rowHover}>
                    <td className="px-4 py-4 text-sm text-slate-900 font-mono">{r.cpt_code}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{r.covered ? "Yes" : "No"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{r.requires_prior_auth ? "Yes" : "No"}</td>
                    <td className="px-4 py-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${r.provenance === "org" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                        {r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card title="Consents">
        <div className="p-5 space-y-3">
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>Type</th><th className={thCell}>Scope</th><th className={thCell}>Granted</th><th className={thCell}>Expires</th><th className={thCell}>Status</th><th className={thCell}></th></tr></thead>
            <tbody className={tbody}>
              {consents.map((c) => {
                const active = !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date());
                const status = c.revoked_at ? "revoked" : active ? "active" : "expired";
                return (
                  <tr key={c.id} className={rowHover}>
                    <td className="px-4 py-4 text-sm text-slate-900">{c.consent_type}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{c.scope ?? "—"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{c.granted_at?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{c.expires_at?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-4"><Badge value={status} /></td>
                    <td className="px-4 py-4">{!c.revoked_at && (
                      <form action={revokeConsentAction}>
                        <input type="hidden" name="consentId" value={c.id} />
                        <input type="hidden" name="patientId" value={id} />
                        <button className={btnDangerText}>Revoke</button>
                      </form>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <form action={grantConsentAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="patientId" value={id} />
            <input name="consentType" placeholder="Type (part2_disclosure)" className={`${inputClass} w-auto`} />
            <input name="scope" placeholder="Scope (e.g. billing)" className={`${inputClass} w-auto`} />
            <input name="expiresAt" type="date" className={`${inputClass} w-auto`} />
            <input name="documentRef" placeholder="Document ref" className={`${inputClass} w-auto`} />
            <button className={btnPrimary}>Grant consent</button>
          </form>
        </div>
      </Card>

      <Card title="Eligibility history">
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Date</th><th className={thCell}>Payer</th><th className={thCell}>Status</th><th className={thCell}>Copay</th></tr></thead>
          <tbody className={tbody}>
            {history.map((c: any) => (
              <tr key={c.id} className={rowHover}>
                <td className="px-4 py-4 text-sm text-slate-600">{c.check_date}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.payer}</td>
                <td className="px-4 py-4"><Badge value={c.status} /></td>
                <td className="px-4 py-4 text-sm text-slate-600">{c.copay ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
