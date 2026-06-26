import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPlatformContext } from "@/lib/auth/platform";
import { signOutAction } from "../(app)/actions";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#0d1b2e] text-white">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-xs">C</div>
            <span className="font-bold">Coverlog · Internal</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-300">{platform.email}</span>
            <form action={signOutAction}>
              <button className="text-slate-300 hover:text-white transition-colors">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
