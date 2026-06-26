export type Patient = { id: string; [k: string]: unknown };
export type EligibilityCheck = { id: string; [k: string]: unknown };
export type PhiContext = { orgId: string; staffId: string };

async function logAccess(
  client: any,
  ctx: PhiContext,
  entry: { action: string; patient_id?: string | null; patient_ids?: string[]; query_context?: string },
) {
  const { error } = await client.from("access_log").insert({
    org_id: ctx.orgId,
    actor_staff_id: ctx.staffId,
    action: entry.action,
    patient_id: entry.patient_id ?? null,
    patient_ids: entry.patient_ids ?? null,
    query_context: entry.query_context ?? null,
  });
  if (error) throw new Error(`PHI access log write failed: ${error.message}`);
}

export async function readPatient(
  client: any, ctx: PhiContext, patientId: string,
): Promise<Patient | null> {
  const { data } = await client
    .from("patients").select("*").eq("id", patientId).is("deleted_at", null).maybeSingle();
  await logAccess(client, ctx, { action: "view_chart", patient_id: patientId });
  return data ?? null;
}

export async function listPatients(
  client: any, ctx: PhiContext, opts: { search?: string } = {},
): Promise<Patient[]> {
  const { data } = await client
    .from("patients").select("*").is("deleted_at", null).order("next_due", { ascending: true });
  const rows: Patient[] = data ?? [];
  await logAccess(client, ctx, {
    action: "list_view",
    patient_ids: rows.map((r) => r.id),
    query_context: opts.search ? `search=${opts.search}` : "all",
  });
  return rows;
}

// Read a patient's eligibility-check history (newest first) AND log the access.
export async function listCheckHistory(
  client: any, ctx: PhiContext, patientId: string,
): Promise<EligibilityCheck[]> {
  const { data } = await client
    .from("eligibility_checks").select("*")
    .eq("patient_id", patientId).is("deleted_at", null)
    .order("check_date", { ascending: false });
  const rows: EligibilityCheck[] = data ?? [];
  await logAccess(client, ctx, { action: "view_check_history", patient_id: patientId });
  return rows;
}

export type PendingVerification = {
  id: string; name: string; primary_payer: string | null; member_id: string | null;
};

// Patients pending eligibility verification — surfaces PHI (name + member id),
// so it goes through the access log like every other PHI read.
export async function listPendingVerifications(
  client: any, ctx: PhiContext,
): Promise<PendingVerification[]> {
  const { data } = await client
    .from("patients").select("id, name, primary_payer, member_id")
    .eq("status", "pending").is("deleted_at", null)
    .order("next_due", { ascending: true, nullsFirst: false });
  const rows: PendingVerification[] = data ?? [];
  await logAccess(client, ctx, {
    action: "list_view",
    patient_ids: rows.map((r) => r.id),
    query_context: "dashboard_pending",
  });
  return rows;
}

export type OrgConsentRow = {
  id: string; patient_id: string; patient_name: string; consent_type: string;
  granted_at: string | null; expires_at: string | null; revoked_at: string | null;
};

// Org-wide consents overview joined to patient names (PHI) — therefore logged.
export async function listOrgConsents(
  client: any, ctx: PhiContext,
): Promise<OrgConsentRow[]> {
  const { data, error } = await client.from("patient_consents")
    .select("id, patient_id, consent_type, granted_at, expires_at, revoked_at, patients!inner(name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listOrgConsents failed: ${error.message}`);
  const rows = (data ?? []) as any[];
  await logAccess(client, ctx, {
    action: "list_view",
    patient_ids: rows.map((r) => r.patient_id),
    query_context: "admin_consents_overview",
  });
  return rows.map((r) => ({
    id: r.id, patient_id: r.patient_id, patient_name: r.patients?.name ?? "",
    consent_type: r.consent_type, granted_at: r.granted_at,
    expires_at: r.expires_at, revoked_at: r.revoked_at,
  }));
}
