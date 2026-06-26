export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { listProviders } from "@/lib/providers/queries";
import { AddProviderForm } from "./_components/AddProviderForm";
import { deleteProviderAction } from "./actions";

export default async function ProvidersPage() {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const providers = await listProviders(supabase);
  const isAdmin = ctx.role === "admin";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Providers</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Name</th><th>NPI</th><th>License</th><th>State</th><th>Expires</th><th></th></tr></thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="p-2">{p.name}</td><td>{p.npi ?? "—"}</td>
              <td>{p.license_type ?? "—"}{p.license_number ? ` ${p.license_number}` : ""}</td>
              <td>{p.license_state ?? "—"}</td><td>{p.license_expiration ?? "—"}</td>
              <td>{isAdmin && (
                <form action={deleteProviderAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="text-red-700 underline">Remove</button>
                </form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && <AddProviderForm />}
    </div>
  );
}
