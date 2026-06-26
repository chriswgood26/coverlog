export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listProviders } from "@/lib/providers/queries";
import { AddProviderForm } from "./_components/AddProviderForm";
import { deleteProviderAction } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { tableWrap, theadRow, thCell, tbody, rowHover, btnDangerText } from "@/lib/ui";

export default async function ProvidersPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const providers = await listProviders(supabase);
  const isAdmin = ctx.role === "admin";
  return (
    <div className="space-y-4">
      <PageHeader title="Providers" subtitle={`${providers.length} total`} />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>NPI</th><th className={thCell}>License</th><th className={thCell}>State</th><th className={thCell}>Expires</th><th className={thCell}></th></tr></thead>
          <tbody className={tbody}>
            {providers.map((p) => (
              <tr key={p.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{p.name}</td>
                <td className="px-4 py-4 text-sm text-slate-600 font-mono">{p.npi ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_type ?? "—"}{p.license_number ? ` ${p.license_number}` : ""}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_state ?? "—"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{p.license_expiration ?? "—"}</td>
                <td className="px-4 py-4">{isAdmin && (
                  <form action={deleteProviderAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className={btnDangerText}>Remove</button>
                  </form>
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
