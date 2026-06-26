import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPlatformContext } from "@/lib/auth/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const TOOLS = [
  { name: "Organizations", desc: "Enable or disable tenant organizations." },
  { name: "Payer Curation", desc: "Curate the master payer list and baseline coverage / claim rules." },
];

export default async function InternalHome() {
  const supabase = await createServerSupabase();
  const platform = await getPlatformContext(supabase);
  if (!platform) redirect("/sign-in");
  return (
    <div className="space-y-4">
      <PageHeader title="Internal" subtitle={platform.email} />
      <Card>
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Tools</h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {TOOLS.map((t) => (
            <li key={t.name} className="px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900">{t.name}</div>
                <div className="text-sm text-slate-500">{t.desc}</div>
              </div>
              <span className="text-xs font-medium text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">Coming soon</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
