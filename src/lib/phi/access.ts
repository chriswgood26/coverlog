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

export type AccessEntry = {
  id: string; occurred_at: string; action: string; actor_name: string;
  patient_id: string | null; patient_label: string;
};
export type DisclosureEntry = {
  id: string; occurred_at: string; action: string; actor_name: string;
  patient_id: string | null; patient_name: string;
  purpose: string | null; disclosed_to: string | null;
};
export type AuditTrail = { access: AccessEntry[]; disclosures: DisclosureEntry[] };

// Org admins' read of their own audit trail. Surfaces patient names (PHI), so it
// logs ONE meta "audit_view" access_log entry. RLS scopes both reads to the org.
export async function listAuditTrail(client: any, ctx: PhiContext): Promise<AuditTrail> {
  const [accRes, discRes] = await Promise.all([
    client.from("access_log")
      .select("id, occurred_at, action, actor_staff_id, patient_id, patient_ids, query_context")
      .order("occurred_at", { ascending: false }).limit(100),
    client.from("disclosure_log")
      .select("id, occurred_at, action, actor_staff_id, patient_id, purpose, disclosed_to")
      .order("occurred_at", { ascending: false }).limit(100),
  ]);
  const accRows: any[] = accRes.data ?? [];
  const discRows: any[] = discRes.data ?? [];

  const staffIds = new Set<string>();
  const patientIds = new Set<string>();
  for (const r of accRows) {
    if (r.actor_staff_id) staffIds.add(r.actor_staff_id);
    if (r.patient_id) patientIds.add(r.patient_id);
    for (const p of r.patient_ids ?? []) patientIds.add(p);
  }
  for (const r of discRows) {
    if (r.actor_staff_id) staffIds.add(r.actor_staff_id);
    if (r.patient_id) patientIds.add(r.patient_id);
  }

  const [staffRes, patRes] = await Promise.all([
    staffIds.size
      ? client.from("staff").select("id, name").in("id", [...staffIds])
      : Promise.resolve({ data: [] }),
    patientIds.size
      ? client.from("patients").select("id, name").in("id", [...patientIds])
      : Promise.resolve({ data: [] }),
  ]);
  const staffName = new Map<string, string>((staffRes.data ?? []).map((s: any) => [s.id, s.name]));
  const patName = new Map<string, string>((patRes.data ?? []).map((p: any) => [p.id, p.name]));

  await logAccess(client, ctx, {
    action: "audit_view",
    patient_ids: [...patientIds],
    query_context: "admin_audit",
  });

  const access: AccessEntry[] = accRows.map((r) => ({
    id: r.id, occurred_at: r.occurred_at, action: r.action,
    actor_name: staffName.get(r.actor_staff_id) ?? "—",
    patient_id: r.patient_id ?? null,
    patient_label: r.patient_id
      ? (patName.get(r.patient_id) ?? "—")
      : (r.patient_ids?.length ? `${r.patient_ids.length} patients` : "—"),
  }));
  const disclosures: DisclosureEntry[] = discRows.map((r) => ({
    id: r.id, occurred_at: r.occurred_at, action: r.action,
    actor_name: staffName.get(r.actor_staff_id) ?? "—",
    patient_id: r.patient_id ?? null,
    patient_name: r.patient_id ? (patName.get(r.patient_id) ?? "—") : "—",
    purpose: r.purpose ?? null, disclosed_to: r.disclosed_to ?? null,
  }));
  return { access, disclosures };
}
