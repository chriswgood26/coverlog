export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listOrgConsents } from "@/lib/phi/access";

export default async function AdminPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");
  const consents = await listOrgConsents(supabase, ctx);
  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link href="/admin/staff" className="underline">Staff</Link>
      </div>
      <h2 className="font-medium">Consents</h2>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Patient</th><th>Type</th><th>Granted</th><th>Expires</th><th>Status</th></tr></thead>
        <tbody>
          {consents.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="p-2">{c.patient_name}</td><td>{c.consent_type}</td>
              <td>{c.granted_at?.slice(0, 10) ?? "—"}</td><td>{c.expires_at?.slice(0, 10) ?? "—"}</td>
              <td>{c.revoked_at ? "revoked" : "active"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
