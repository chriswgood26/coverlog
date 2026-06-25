export type PatientInsert = {
  org_id: string;
  name: string;
  member_id: string;
  primary_payer: string;
  status: "pending";
};

// Minimal CSV parser handling quoted fields and commas within quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      // Any other char (including embedded \n and \r) is part of the field.
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k] != null && row[k] !== "") return row[k];
  return "";
}

export function parsePatientsCsv(
  text: string, orgId: string,
): { rows: PatientInsert[]; skipped: number } {
  const parsed = parseCsv(text);
  if (parsed.length < 2) return { rows: [], skipped: 0 };
  const header = parsed[0].map((h) => h.trim());
  const out: PatientInsert[] = [];
  let skipped = 0;
  for (const cells of parsed.slice(1)) {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (cells[i] ?? "").trim(); });
    const name = pick(rec, ["Name", "name"]);
    if (!name) { skipped++; continue; }
    out.push({
      org_id: orgId,
      name,
      member_id: pick(rec, ["Member ID", "member_id"]),
      primary_payer: pick(rec, ["Payer", "payer"]) || "Other",
      status: "pending",
    });
  }
  return { rows: out, skipped };
}
