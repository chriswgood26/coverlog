export const dynamic = "force-dynamic";
import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth/context";
import { resolveCoverage, resolveClaimRules } from "@/lib/payers/resolve";
import { CoveredCodesTab } from "./_components/CoveredCodesTab";
import { ClaimRulesTab } from "./_components/ClaimRulesTab";
import { listEnrollmentsForPayer, listProviders } from "@/lib/providers/queries";
import { EnrolledProvidersTab } from "./_components/EnrolledProvidersTab";

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
      <h1 className="text-xl font-semibold">{(payer as any).payer_name}</h1>
      <section>
        <h2 className="font-medium">Portal Access</h2>
        <p className="text-sm">{(payer as any).portal_url
          ? <a href={(payer as any).portal_url} target="_blank" rel="noreferrer" className="underline">Open portal</a>
          : "No portal URL"}</p>
        {(payer as any).login_notes && <p className="text-sm text-gray-600">{(payer as any).login_notes}</p>}
      </section>
      {!masterId && <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">Link this payer to a canonical payer to see Coverlog&apos;s baseline coverage &amp; claim rules.</p>}
      <EnrolledProvidersTab rows={enrollments} providers={providers} payerDirectoryId={id} isAdmin={ctx.role === "admin"} />
      <CoveredCodesTab rows={coverage} payerMasterId={masterId} payerDirectoryId={id} />
      <ClaimRulesTab rows={rules} payerMasterId={masterId} payerDirectoryId={id} />
    </div>
  );
}
