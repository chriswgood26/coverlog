import type { PhiContext } from "@/lib/phi/access";
import { listPatients } from "@/lib/phi/access";
import { hasValidConsent } from "@/lib/phi/consent";
import { logDisclosure } from "@/lib/phi/disclosure";

const COLUMNS: [keyof any, string][] = [
  ["name", "Name"], ["member_id", "Member ID"], ["primary_payer", "Payer"],
  ["status", "Status"], ["last_checked", "Last Checked"], ["next_due", "Next Due"],
];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export org patients to CSV, but ONLY those with a valid consent (42 CFR Part 2);
// records the export as a disclosure. Throws if nothing is exportable.
export async function exportPatientsCsv(
  client: any, ctx: PhiContext, opts: { purpose?: string } = {},
): Promise<string> {
  const patients = await listPatients(client, ctx, {});
  const consented: any[] = [];
  for (const p of patients) {
    if (await hasValidConsent(client, p.id as string)) consented.push(p);
  }
  if (consented.length === 0) {
    throw new Error("CSV export blocked: no patient has a valid consent on file");
  }

  const header = COLUMNS.map(([, label]) => label).join(",");
  const lines = consented.map((p) => COLUMNS.map(([key]) => csvCell(p[key])).join(","));
  const csv = [header, ...lines].join("\n") + "\n";

  await logDisclosure(client, ctx, {
    action: "csv_export",
    purpose: opts.purpose,
    disclosed_to: "self-service export",
    detail: { patientIds: consented.map((p) => p.id), count: consented.length },
  });
  return csv;
}
