import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getPlatformContext } from "@/lib/auth/platform";
import { listAllOrgs } from "@/lib/orgs/admin";
import { setOrgStatusAction } from "./actions";
import { DisableButton } from "./_components/DisableButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function InternalOrgsPage() {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  const orgs = await listAllOrgs(createServiceSupabase());
  return (
    <div className="space-y-4">
      <PageHeader title="Organizations" subtitle={`${orgs.length} total`} backHref="/internal" />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Status</th><th className={thCell}>Created</th><th className={thCell}>Action</th></tr></thead>
          <tbody className={tbody}>
            {orgs.map((o) => (
              <tr key={o.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{o.name}</td>
                <td className="px-4 py-4"><Badge value={o.status} /></td>
                <td className="px-4 py-4 text-sm text-slate-600">{o.created_at.slice(0, 10)}</td>
                <td className="px-4 py-4">
                  <form action={setOrgStatusAction}>
                    <input type="hidden" name="orgId" value={o.id} />
                    <input type="hidden" name="status" value={o.status === "active" ? "disabled" : "active"} />
                    {o.status === "active"
                      ? <DisableButton />
                      : <button type="submit" className="text-teal-600 hover:text-teal-700 text-sm font-medium">Enable</button>}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
