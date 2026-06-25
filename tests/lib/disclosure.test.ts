import { describe, it, expect } from "vitest";
import { logDisclosure } from "@/lib/phi/disclosure";

describe("logDisclosure", () => {
  it("inserts a disclosure_log row with mapped fields", async () => {
    const inserted: any[] = [];
    const client: any = { from: (t: string) => ({ insert(row: any){ if (t==="disclosure_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; } }) };
    await logDisclosure(client, { orgId: "o1", staffId: "s1" }, { action: "csv_export", purpose: "billing", disclosed_to: "self" });
    expect(inserted[0]).toMatchObject({ org_id: "o1", actor_staff_id: "s1", action: "csv_export", purpose: "billing", disclosed_to: "self" });
  });
  it("throws when the insert errors", async () => {
    const client: any = { from: () => ({ insert(){ return { async then(r: any){ r({ error: { message: "boom" } }); } }; } }) };
    await expect(logDisclosure(client, { orgId: "o1", staffId: "s1" }, { action: "csv_export" }))
      .rejects.toThrow(/disclosure log write failed/i);
  });
});
