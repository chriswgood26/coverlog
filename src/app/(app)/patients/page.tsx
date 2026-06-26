import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listPatients } from "@/lib/phi/access";
import { redirect } from "next/navigation";
import { AddPatientForm } from "./_components/AddPatientForm";
import { CsvControls } from "./_components/CsvControls";
import { DeletePatientButton } from "./_components/DeletePatientButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover, inputClass, btnPrimary } from "@/lib/ui";

export const dynamic = "force-dynamic";

const FILTERS: { label: string; value?: string }[] = [
  { label: "All" },
  { label: "Verified", value: "verified" },
  { label: "Pending", value: "pending" },
  { label: "Inactive", value: "inactive" },
];

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const statusFilter = status && ["verified", "pending", "inactive"].includes(status) ? status : undefined;
  const patients = await listPatients(supabase, ctx, { search: q, status: statusFilter });

  const filterHref = (s?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (s) params.set("status", s);
    const qs = params.toString();
    return qs ? `/patients?${qs}` : "/patients";
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Insurance Eligibility" subtitle={`${patients.length}${q || statusFilter ? " matching" : " total"}`}>
        <CsvControls />
      </PageHeader>

      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Add Patient</h2>
        <AddPatientForm />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Search Patients</h2>
        <form method="get" className="flex gap-2">
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          <input name="q" defaultValue={q ?? ""} placeholder="Search by name, member ID, or payer…" className={inputClass} />
          <button className={btnPrimary}>Search</button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (f.value ?? "") === (statusFilter ?? "");
          return (
            <Link
              key={f.label}
              href={filterHref(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active ? "bg-teal-500 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {patients.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">No patients found.</div>
      ) : (
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Payer</th><th className={thCell}>Status</th><th className={thCell}>Next due</th><th className={thCell}></th></tr></thead>
            <tbody className={tbody}>
              {patients.map((p: any) => (
                <tr key={p.id} className={rowHover}>
                  <td className="px-4 py-4"><Link href={`/patients/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-teal-600">{p.name}</Link></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.primary_payer ?? "—"}</td>
                  <td className="px-4 py-4"><Badge value={p.status} /></td>
                  <td className="px-4 py-4 text-sm text-slate-600">{p.next_due ?? "—"}</td>
                  <td className="px-4 py-4 text-right"><DeletePatientButton id={p.id} name={p.name} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
