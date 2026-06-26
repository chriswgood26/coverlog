import type { SupabaseClient } from "@supabase/supabase-js";

export type Provider = {
  id: string; name: string; npi: string | null; license_type: string | null;
  license_number: string | null; license_state: string | null;
  license_expiration: string | null; status: string; specialty: string | null;
  deleted_at: string | null;
};
export type EnrollmentRow = {
  id: string; provider_id: string; payer_id: string; provider_name: string;
  status: string; par_status: string | null; effective_date: string | null;
  termination_date: string | null; revalidation_due: string | null;
  caqh_id: string | null; notes: string | null;
};

export async function listProviders(
  client: Pick<SupabaseClient, "from">, opts: { search?: string } = {},
): Promise<Provider[]> {
  let query = client.from("providers")
    .select("id, name, npi, license_type, license_number, license_state, license_expiration, status, specialty, deleted_at")
    .is("deleted_at", null);
  const q = (opts.search ?? "").replace(/[,()*%"\\]/g, "").trim();
  if (q) query = query.or(`name.ilike.%${q}%,npi.ilike.%${q}%,specialty.ilike.%${q}%`);
  const { data, error } = await query.order("name");
  if (error) throw new Error(`listProviders failed: ${error.message}`);
  return (data ?? []) as Provider[];
}

export async function getProvider(
  client: Pick<SupabaseClient, "from">, id: string,
): Promise<Provider | null> {
  const { data, error } = await client.from("providers")
    .select("id, name, npi, license_type, license_number, license_state, license_expiration, status, specialty, deleted_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`getProvider failed: ${error.message}`);
  return (data ?? null) as Provider | null;
}

// providers!inner(name) embeds the joined provider; we flatten to provider_name.
function flattenEnrollments(data: any[]): EnrollmentRow[] {
  return (data ?? []).map((r: any) => ({
    id: r.id, provider_id: r.provider_id, payer_id: r.payer_id,
    provider_name: r.providers?.name ?? "", status: r.status, par_status: r.par_status,
    effective_date: r.effective_date, termination_date: r.termination_date,
    revalidation_due: r.revalidation_due, caqh_id: r.caqh_id, notes: r.notes,
  }));
}

export async function listEnrollmentsForPayer(
  client: Pick<SupabaseClient, "from">, payerDirectoryId: string,
): Promise<EnrollmentRow[]> {
  const { data, error } = await client.from("payer_enrollments")
    .select("id, provider_id, payer_id, status, par_status, effective_date, termination_date, revalidation_due, caqh_id, notes, providers!inner(name)")
    .eq("payer_id", payerDirectoryId);
  if (error) throw new Error(`listEnrollmentsForPayer failed: ${error.message}`);
  return flattenEnrollments(data ?? []);
}

export async function listEnrollmentsForProvider(
  client: Pick<SupabaseClient, "from">, providerId: string,
): Promise<EnrollmentRow[]> {
  const { data, error } = await client.from("payer_enrollments")
    .select("id, provider_id, payer_id, status, par_status, effective_date, termination_date, revalidation_due, caqh_id, notes, providers!inner(name)")
    .eq("provider_id", providerId);
  if (error) throw new Error(`listEnrollmentsForProvider failed: ${error.message}`);
  return flattenEnrollments(data ?? []);
}

export type ExpiringCredential = {
  id: string; name: string; license_type: string | null; license_expiration: string;
};

export async function listExpiringCredentials(
  client: Pick<SupabaseClient, "from">,
): Promise<ExpiringCredential[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 60);
  const { data, error } = await client.from("providers")
    .select("id, name, license_type, license_expiration")
    .is("deleted_at", null)
    .not("license_expiration", "is", null)
    .lte("license_expiration", cutoff.toISOString().slice(0, 10))
    .order("license_expiration", { ascending: true });
  if (error) throw new Error(`listExpiringCredentials failed: ${error.message}`);
  return (data ?? []) as ExpiringCredential[];
}
