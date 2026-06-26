import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return (
    <div className="min-h-screen">
      <nav className="flex gap-4 border-b p-4 text-sm">
        <Link href="/dashboard" className="font-medium">Dashboard</Link>
        <Link href="/patients">Patients</Link>
        <Link href="/payers">Payers</Link>
        <Link href="/providers">Providers</Link>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
