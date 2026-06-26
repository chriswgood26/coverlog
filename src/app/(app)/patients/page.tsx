import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listPatients } from "@/lib/phi/access";
import { redirect } from "next/navigation";
import { AddPatientForm } from "./_components/AddPatientForm";
import { CsvControls } from "./_components/CsvControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patients = await listPatients(supabase, ctx, {});
  return (
    <div className="space-y-4">
      <PageHeader title="Insurance Eligibility" subtitle={`${patients.length} total`}>
        <CsvControls />
      </PageHeader>
      <AddPatientForm />
      {patients.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">No patients yet.</div>
      ) : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Payer</th><th className={thCell}>Status</th><th className={thCell}>Next due</th></tr></thead>
            <tbody className={tbody}>
              {patients.map((p: any) => (
                <tr key={p.id} className={rowHover}>
                  <td className="px-4 py-4"><Link href={`/patients/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-teal-600">{p.name}</Link></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.primary_payer ?? "—"}</td>
                  <td className="px-4 py-4"><Badge value={p.status} /></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.next_due ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
