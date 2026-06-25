import { describe, it, expect } from "vitest";
import { logCheck } from "@/lib/patients/mutations";
import { listCheckHistory } from "@/lib/phi/access";

describe("logCheck wrapper", () => {
  it("calls the RPC with mapped params and returns the id", async () => {
    let called: any;
    const client = { rpc: async (name: string, args: any) => { called = { name, args }; return { data: "chk-1", error: null }; } } as any;
    const res = await logCheck(client, { patientId: "p1", status: "verified", payer: "Aetna" });
    expect(res).toEqual({ checkId: "chk-1" });
    expect(called.name).toBe("log_eligibility_check");
    expect(called.args).toMatchObject({ p_patient_id: "p1", p_status: "verified", p_payer: "Aetna" });
  });
});

describe("listCheckHistory", () => {
  it("returns checks and writes a view_check_history access_log row", async () => {
    const inserted: any[] = [];
    const client: any = {
      from(table: string) {
        return {
          select() { return this; }, eq() { return this; }, is() { return this; },
          order() { return this; },
          then(r: any) { r({ data: [{ id: "c1" }, { id: "c2" }], error: null }); },
          insert(row: any) { if (table === "access_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; },
        };
      },
    };
    const rows = await listCheckHistory(client, { orgId: "o1", staffId: "s1" }, "p1");
    expect(rows).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ action: "view_check_history", patient_id: "p1" });
  });
});
