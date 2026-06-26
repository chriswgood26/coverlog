export const dynamic = "force-dynamic";
import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { resolveCoverage, resolveClaimRules } from "@/lib/payers/resolve";
import { CoveredCodesTab } from "./_components/CoveredCodesTab";
import { ClaimRulesTab } from "./_components/ClaimRulesTab";
import { listEnrollmentsForPayer, listProviders } from "@/lib/providers/queries";
import { EnrolledProvidersTab } from "./_components/EnrolledProvidersTab";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

export default async function PayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const ctx = await getStaffContext(supabase);
  if (!ctx) redirect("/onboarding");
  const { data: payer } = await supabase
    .from("payer_directory")
    .select("id, payer_name, portal_url, login_notes, username_hint, payer_master_id")
    .eq("id", id).maybeSingle();
  if (!payer) notFound();

  const masterId = (payer as any).payer_master_id as string | null;
  const [coverage, rules] = masterId
    ? await Promise.all([resolveCoverage(supabase, masterId), resolveClaimRules(supabase, masterId)])
    : [[], []];
  const [enrollments, providers] = await Promise.all([
    listEnrollmentsForPayer(supabase, id),
    listProviders(supabase),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={(payer as any).payer_name} backHref="/payers" />
      <Card title="Portal Access">
        <div className="p-5 text-sm space-y-1">
          <p>{(payer as any).portal_url
            ? <a href={(payer as any).portal_url} target="_blank" rel="noreferrer" className="text-teal-600 hover:text-teal-700 font-medium">Open portal</a>
            : <span className="text-slate-400">No portal URL</span>}</p>
          {(payer as any).login_notes && <p className="text-slate-500">{(payer as any).login_notes}</p>}
        </div>
      </Card>
      {!masterId && <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">Link this payer to a canonical payer to see Coverlog&apos;s baseline coverage &amp; claim rules.</p>}
      <EnrolledProvidersTab rows={enrollments} providers={providers} payerDirectoryId={id} isAdmin={ctx.role === "admin"} />
      <CoveredCodesTab rows={coverage} payerMasterId={masterId} payerDirectoryId={id} />
      <ClaimRulesTab rows={rules} payerMasterId={masterId} payerDirectoryId={id} />
    </div>
  );
}
