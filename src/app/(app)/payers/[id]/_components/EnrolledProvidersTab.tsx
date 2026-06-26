import type { EnrollmentRow, Provider } from "@/lib/providers/queries";
import { saveEnrollmentAction } from "../../actions";

export function EnrolledProvidersTab({ rows, providers, payerDirectoryId, isAdmin }:
  { rows: EnrollmentRow[]; providers: Provider[]; payerDirectoryId: string; isAdmin: boolean }) {
  return (
    <section>
      <h2 className="font-medium">Enrolled Providers</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Provider</th><th>Status</th><th>PAR</th><th>Effective</th><th>Revalidation</th><th>CAQH</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.provider_name}</td><td>{r.status}</td>
              <td>{r.par_status ?? "—"}</td><td>{r.effective_date ?? "—"}</td>
              <td>{r.revalidation_due ?? "—"}</td><td>{r.caqh_id ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && providers.length > 0 && (
        <form action={saveEnrollmentAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="payerDirectoryId" value={payerDirectoryId} />
          <select name="providerId" required className="border p-1">
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="status" className="border p-1">
            <option value="pending">pending</option><option value="enrolled">enrolled</option>
            <option value="terminated">terminated</option><option value="not_enrolled">not enrolled</option>
          </select>
          <select name="parStatus" className="border p-1">
            <option value="">PAR —</option><option value="in_network">in network</option>
            <option value="out_of_network">out of network</option>
          </select>
          <input name="effectiveDate" type="date" className="border p-1" />
          <input name="revalidationDue" type="date" className="border p-1" />
          <input name="caqhId" placeholder="CAQH ID" className="border p-1 w-28" />
          <button className="rounded bg-black px-2 py-1 text-white text-sm">Save enrollment</button>
        </form>
      )}
    </section>
  );
}
