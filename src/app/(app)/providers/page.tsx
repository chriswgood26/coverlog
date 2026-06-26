export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listProviders } from "@/lib/providers/queries";
import { AddProviderForm } from "./_components/AddProviderForm";
import { deleteProviderAction, setProviderStatusAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover, btnDangerText, inputClass, btnPrimary } from "@/lib/ui";

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const providers = await listProviders(supabase, { search: q });
  const isAdmin = ctx.role === "admin";
  return (
    <div className="space-y-4">
      <PageHeader title="Providers" subtitle={`${providers.length}${q ? " matching" : " total"}`} />
      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Search by name, NPI, or specialty…" className={inputClass} />
        <button className={btnPrimary}>Search</button>
      </form>
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}>
            <th className={thCell}>Name</th><th className={thCell}>NPI</th><th className={thCell}>Specialty</th>
            <th className={thCell}>License</th><th className={thCell}>State</th><th className={thCell}>Expires</th>
            <th className={thCell}>Status</th><th className={thCell}></th>
          </tr></thead>
          <tbody className={tbody}>
            {providers.map((p) => (
              <tr key={p.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{p.name}</td>
                <td className="px-4 py-4 text-sm text-slate-600 font-mono">{p.npi ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.specialty ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_type ?? "—"}{p.license_number ? ` ${p.license_number}` : ""}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_state ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_expiration ?? "—"}</td>
                <td className="px-4 py-4"><Badge value={p.status} /></td>
                <td className="px-4 py-4">{isAdmin && (
                  <div className="flex items-center gap-3">
                    <form action={setProviderStatusAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={p.id} />
                      <select name="status" defaultValue={p.status} className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700">
                        <option value="active">active</option>
                        <option value="pending">pending</option>
                        <option value="flagged">flagged</option>
                      </select>
                      <button className="text-teal-600 hover:text-teal-700 text-xs font-medium">Set</button>
                    </form>
                    <form action={deleteProviderAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className={btnDangerText}>Remove</button>
                    </form>
                  </div>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin && <AddProviderForm />}
    </div>
  );
}
