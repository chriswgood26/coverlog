import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the consent + access modules the exporter depends on.
// hasValidConsent is a reconfigurable vi.fn so individual tests can
// control which patients are consented.
vi.mock("@/lib/phi/consent", () => ({
  hasValidConsent: vi.fn(async (_c: any, id: string) => id === "p1"), // default: only p1 consented
}));
vi.mock("@/lib/phi/access", async (orig) => ({
  ...(await orig<any>()),
  listPatients: vi.fn(async () => [
    { id: "p1", name: "Jane", member_id: "M1", primary_payer: "Aetna", status: "verified" },
    { id: "p2", name: "John", member_id: "M2", primary_payer: "Cigna", status: "pending" },
  ]),
}));

import { exportPatientsCsv } from "@/lib/csv/export";
import { hasValidConsent } from "@/lib/phi/consent";

function client() {
  const inserted: any[] = [];
  return { _inserted: inserted, from: (t: string) => ({ insert(row: any){ if (t==="disclosure_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; } }) } as any;
}

describe("exportPatientsCsv", () => {
  beforeEach(() => {
    // Restore the default mock (only p1 consented) before each test.
    (hasValidConsent as any).mockImplementation(async (_c: any, id: string) => id === "p1");
  });

  it("exports only consented patients and writes a disclosure_log row", async () => {
    const c = client();
    const csv = await exportPatientsCsv(c, { orgId: "o1", staffId: "s1" }, { purpose: "billing" });
    expect(csv).toContain("Jane");
    expect(csv).not.toContain("John");          // p2 lacked consent
    expect(c._inserted).toHaveLength(1);
    expect(c._inserted[0]).toMatchObject({ action: "csv_export", purpose: "billing" });
    expect(c._inserted[0].detail).toMatchObject({ patientIds: ["p1"], count: 1 });
  });

  it("throws and writes NO disclosure_log row when no patient has consent", async () => {
    (hasValidConsent as any).mockResolvedValue(false); // no patient consented
    const c = client();
    await expect(
      exportPatientsCsv(c, { orgId: "o1", staffId: "s1" }, { purpose: "billing" }),
    ).rejects.toThrow(/no patient has a valid consent|export blocked/i);
    expect(c._inserted).toHaveLength(0); // blocked export records no false disclosure
  });
});
