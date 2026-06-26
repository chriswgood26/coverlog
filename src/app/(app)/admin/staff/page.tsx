export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listStaff } from "@/lib/staff/queries";
import { setStaffRoleAction, deactivateStaffAction, reactivateStaffAction } from "../actions";

export default async function StaffAdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const staff = await listStaff(supabase);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Staff</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-2">{s.name}</td><td>{s.email}</td>
              <td>
                <form action={setStaffRoleAction} className="inline">
                  <input type="hidden" name="staffId" value={s.id} />
                  <input type="hidden" name="role" value={s.role === "admin" ? "specialist" : "admin"} />
                  <button className="underline">{s.role} → {s.role === "admin" ? "specialist" : "admin"}</button>
                </form>
              </td>
              <td>{s.deleted_at ? "inactive" : "active"}</td>
              <td>
                {s.deleted_at ? (
                  <form action={reactivateStaffAction}>
                    <input type="hidden" name="staffId" value={s.id} />
                    <button className="text-blue-700 underline">Reactivate</button>
                  </form>
                ) : (
                  <form action={deactivateStaffAction}>
                    <input type="hidden" name="staffId" value={s.id} />
                    <button className="text-red-700 underline">Deactivate</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
