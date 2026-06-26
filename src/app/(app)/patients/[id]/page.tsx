import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { readPatient, listCheckHistory } from "@/lib/phi/access";
import { hasValidConsent, listConsentsForPatient } from "@/lib/phi/consent";
import { redirect, notFound } from "next/navigation";
import { LogCheckDrawer } from "../_components/LogCheckDrawer";
import { resolveCoverage } from "@/lib/payers/resolve";
import { linkPatientPayerAction, grantConsentAction, revokeConsentAction } from "../actions";

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{patient.name as string}</h1>
      {!consent && (
        <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
          No valid 42 CFR Part 2 consent on file — disclosure/export is blocked for this patient.
        </div>
      )}
      <LogCheckDrawer patientId={id} />
      <section className="space-y-2">
        <h2 className="font-medium">Primary payer coverage</h2>
        <form action={linkPatientPayerAction} className="flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="patientId" value={id} />
          <select name="payerDirectoryId" defaultValue={payerDirId ?? ""} className="border p-1">
            <option value="">— not linked —</option>
            {(orgPayers ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.payer_name}</option>)}
          </select>
          <button className="rounded bg-black px-2 py-1 text-white">Link payer</button>
        </form>
        {linked && !linked.payer_master_id && (
          <p className="text-sm text-amber-700">Linked payer isn&apos;t mapped to a canonical payer yet — no baseline coverage to show.</p>
        )}
        {coverage.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left"><th className="p-2">CPT</th><th>Covered</th><th>Prior auth</th><th>Source</th></tr></thead>
            <tbody>
              {coverage.map((r) => (
                <tr key={r.cpt_code} className="border-b">
                  <td className="p-2">{r.cpt_code}</td><td>{r.covered ? "Yes" : "No"}</td>
                  <td>{r.requires_prior_auth ? "Yes" : "No"}</td>
                  <td>{r.provenance === "org" ? "Your clinic" : "Coverlog baseline"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Consents</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Type</th><th>Scope</th><th>Granted</th><th>Expires</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {consents.map((c) => {
              const active = !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date());
              return (
                <tr key={c.id} className="border-b">
                  <td className="p-2">{c.consent_type}</td><td>{c.scope ?? "—"}</td>
                  <td>{c.granted_at?.slice(0, 10) ?? "—"}</td><td>{c.expires_at?.slice(0, 10) ?? "—"}</td>
                  <td>{c.revoked_at ? "revoked" : active ? "active" : "expired"}</td>
                  <td>{!c.revoked_at && (
                    <form action={revokeConsentAction}>
                      <input type="hidden" name="consentId" value={c.id} />
                      <input type="hidden" name="patientId" value={id} />
                      <button className="text-red-700 underline">Revoke</button>
                    </form>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <form action={grantConsentAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="patientId" value={id} />
          <input name="consentType" placeholder="Type (part2_disclosure)" className="border p-1" />
          <input name="scope" placeholder="Scope (e.g. billing)" className="border p-1" />
          <input name="expiresAt" type="date" className="border p-1" />
          <input name="documentRef" placeholder="Document ref" className="border p-1" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Grant consent</button>
        </form>
      </section>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Date</th><th>Payer</th><th>Status</th><th>Copay</th></tr></thead>
        <tbody>
          {history.map((c: any) => (
            <tr key={c.id} className="border-b"><td className="p-2">{c.check_date}</td><td>{c.payer}</td><td>{c.status}</td><td>{c.copay ?? "—"}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
