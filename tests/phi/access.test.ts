import { describe, it, expect, vi } from "vitest";
import { readPatient, listPatients } from "@/lib/phi/access";

// Minimal fake client capturing inserts and returning canned reads.
function fakeClient(patientRows: any[]) {
  const inserted: any[] = [];
  const client: any = {
    from(table: string) {
      return {
        _table: table,
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        order() { return this; },
        async maybeSingle() { return { data: patientRows[0] ?? null, error: null }; },
        then(resolve: any) { resolve({ data: patientRows, error: null }); },
        insert(row: any) { if (table === "access_log") inserted.push(row); return { async then(r: any){ r({ error: null }); } }; },
      };
    },
    _inserted: inserted,
  };
  return client;
}

const ctx = { orgId: "org-1", staffId: "staff-1" };

describe("PHI access layer", () => {
  it("readPatient writes a view_chart access_log row", async () => {
    const client = fakeClient([{ id: "p1", name: "Pat" }]);
    const p = await readPatient(client, ctx, "p1");
    expect(p?.id).toBe("p1");
    expect(client._inserted).toHaveLength(1);
    expect(client._inserted[0]).toMatchObject({
      org_id: "org-1", actor_staff_id: "staff-1", action: "view_chart", patient_id: "p1",
    });
  });

  it("listPatients writes a list_view row with patient_ids", async () => {
    const client = fakeClient([{ id: "p1" }, { id: "p2" }]);
    const rows = await listPatients(client, ctx, { search: "smith" });
    expect(rows).toHaveLength(2);
    expect(client._inserted[0]).toMatchObject({
      action: "list_view", patient_ids: ["p1", "p2"], query_context: "search=smith",
    });
  });
});
