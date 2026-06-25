import { describe, it, expect } from "vitest";
import { parsePatientsCsv } from "@/lib/csv/import";

describe("parsePatientsCsv", () => {
  it("maps header variants and defaults status to pending", () => {
    const csv = "Name,Member ID,Payer\nJane Doe,M1,Aetna\nJohn Roe,M2,Cigna\n";
    const { rows, skipped } = parsePatientsCsv(csv, "org-1");
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { org_id: "org-1", name: "Jane Doe", member_id: "M1", primary_payer: "Aetna", status: "pending" },
      { org_id: "org-1", name: "John Roe", member_id: "M2", primary_payer: "Cigna", status: "pending" },
    ]);
  });

  it("skips rows with no name and defaults missing payer to 'Other'", () => {
    const csv = "name,member_id,payer\n,M9,Humana\nReal Name,M3,\n";
    const { rows, skipped } = parsePatientsCsv(csv, "org-1");
    expect(skipped).toBe(1);
    expect(rows).toEqual([
      { org_id: "org-1", name: "Real Name", member_id: "M3", primary_payer: "Other", status: "pending" },
    ]);
  });

  it("returns empty for header-only or blank input", () => {
    expect(parsePatientsCsv("Name,Payer\n", "org-1")).toEqual({ rows: [], skipped: 0 });
    expect(parsePatientsCsv("", "org-1")).toEqual({ rows: [], skipped: 0 });
  });

  it("preserves newlines and commas inside quoted fields without splitting the record", () => {
    const csv = 'Name,Member ID,Payer\n"Doe, Jane","M1\nM1-alt",Aetna\n';
    const { rows, skipped } = parsePatientsCsv(csv, "org-1");
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { org_id: "org-1", name: "Doe, Jane", member_id: "M1\nM1-alt", primary_payer: "Aetna", status: "pending" },
    ]);
  });
});
