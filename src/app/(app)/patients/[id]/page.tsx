import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { readPatient, listCheckHistory } from "@/lib/phi/access";
import { hasValidConsent } from "@/lib/phi/consent";
import { redirect, notFound } from "next/navigation";
import { LogCheckDrawer } from "../_components/LogCheckDrawer";
import { resolveCoverage } from "@/lib/payers/resolve";
import { linkPatientPayerAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patient = await readPatient(supabase, ctx, id);
  if (!patient) notFound();
  const [history, consent] = await Promise.all([
    listCheckHistory(supabase, ctx, id),
    hasValidConsent(supabase, id),
  ]);
  const payerDirId = (patient as any).primary_payer_directory_id as string | null;
  const { data: orgPayers } = await supabase
    .from("payer_directory").select("id, payer_name, payer_master_id").order("payer_name");
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
