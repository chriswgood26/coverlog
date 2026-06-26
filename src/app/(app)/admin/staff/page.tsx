export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listStaff } from "@/lib/staff/queries";
import { setStaffRoleAction, deactivateStaffAction, reactivateStaffAction } from "../actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { tableWrap, theadRow, thCell, tbody, rowHover, linkTeal, btnDangerText } from "@/lib/ui";

export default async function StaffAdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const staff = await listStaff(supabase);
  return (
    <div className="space-y-4">
      <PageHeader title="Staff" subtitle={`${staff.length} total`} backHref="/admin" />
      <div className={tableWrap}>
        <table className="w-full">
          <thead><tr className={theadRow}><th className={thCell}>Name</th><th className={thCell}>Email</th><th className={thCell}>Role</th><th className={thCell}>Status</th><th className={thCell}></th></tr></thead>
          <tbody className={tbody}>
            {staff.map((s) => (
              <tr key={s.id} className={rowHover}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{s.email}</td>
                <td className="px-4 py-4">
                  <form action={setStaffRoleAction} className="inline-flex items-center gap-2">
                    <input type="hidden" name="staffId" value={s.id} />
                    <input type="hidden" name="role" value={s.role === "admin" ? "specialist" : "admin"} />
                    <Badge value={s.role} />
                    <button className={`${linkTeal} text-xs`}>→ {s.role === "admin" ? "specialist" : "admin"}</button>
                  </form>
                </td>
                <td className="px-4 py-4"><Badge value={s.deleted_at ? "inactive" : "active"} /></td>
                <td className="px-4 py-4">
                  {s.deleted_at ? (
                    <form action={reactivateStaffAction}>
                      <input type="hidden" name="staffId" value={s.id} />
                      <button className={`${linkTeal} text-xs`}>Reactivate</button>
                    </form>
                  ) : (
                    <form action={deactivateStaffAction}>
                      <input type="hidden" name="staffId" value={s.id} />
                      <button className={btnDangerText}>Deactivate</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
