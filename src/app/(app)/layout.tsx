import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { Sidebar } from "./_components/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  return (
    <>
      <div className="fixed top-0 left-0 right-0 h-[3px] bg-teal-500 z-50" />
      <div className="flex min-h-screen bg-slate-50 pt-[3px]">
        <Sidebar isAdmin={ctx.role === "admin"} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </>
  );
}
