import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { readPatient, listCheckHistory } from "@/lib/phi/access";
import { hasValidConsent } from "@/lib/phi/consent";
import { redirect, notFound } from "next/navigation";
import { LogCheckDrawer } from "../_components/LogCheckDrawer";

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
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{patient.name as string}</h1>
      {!consent && (
        <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
          No valid 42 CFR Part 2 consent on file — disclosure/export is blocked for this patient.
        </div>
      )}
      <LogCheckDrawer patientId={id} />
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
