import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listPatients } from "@/lib/phi/access";
import { redirect } from "next/navigation";
import { AddPatientForm } from "./_components/AddPatientForm";
import { CsvControls } from "./_components/CsvControls";

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const patients = await listPatients(supabase, ctx, {});
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Patients</h1>
        <CsvControls />
      </div>
      <AddPatientForm />
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Name</th><th>Payer</th><th>Status</th><th>Next due</th></tr></thead>
        <tbody>
          {patients.map((p: any) => (
            <tr key={p.id} className="border-b">
              <td className="p-2"><Link href={`/patients/${p.id}`} className="underline">{p.name}</Link></td>
              <td>{p.primary_payer ?? "—"}</td><td>{p.status}</td><td>{p.next_due ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
