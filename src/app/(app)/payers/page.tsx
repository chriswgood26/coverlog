export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";

export default async function PayersPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const { data: payers } = await supabase
    .from("payer_directory")
    .select("id, payer_name, portal_url, payer_master_id")
    .order("payer_name");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payers</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Payer</th><th>Portal</th><th>Linked</th></tr></thead>
        <tbody>
          {(payers ?? []).map((p: any) => (
            <tr key={p.id} className="border-b">
              <td className="p-2"><Link href={`/payers/${p.id}`} className="underline">{p.payer_name}</Link></td>
              <td>{p.portal_url ? <a href={p.portal_url} target="_blank" rel="noreferrer" className="underline">Open portal</a> : "—"}</td>
              <td>{p.payer_master_id ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
