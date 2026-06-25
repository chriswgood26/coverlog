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
