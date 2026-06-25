import { describe, it, expect } from "vitest";
import { addPatient } from "@/lib/patients/mutations";
import type { StaffContext } from "@/lib/auth/context";

const CTX: StaffContext = { orgId: "o1", staffId: "s1", role: "admin" };

// Minimal fake Supabase client. Captures the inserted row and returns a
// configurable { data, error } from .single().
function fakeClient(result: { data: any; error: any }) {
  const captured: { row?: any } = {};
  const client = {
    from(_table: string) {
      return {
        insert(row: any) { captured.row = row; return this; },
        select(_cols: string) { return this; },
        async single() { return result; },
      };
    },
  } as any;
  return { client, captured };
}

describe("addPatient (wrapper)", () => {
  it("inserts the right row and returns the new id", async () => {
    const { client, captured } = fakeClient({ data: { id: "p-new" }, error: null });

    const out = await addPatient(client, CTX, {
      name: "Jane",
      memberId: "M1",
      primaryPayer: "Aetna",
    });

    expect(out).toEqual({ id: "p-new" });
    expect(captured.row).toEqual({
      org_id: "o1",
      name: "Jane",
      member_id: "M1",
      primary_payer: "Aetna",
      dob: null,
      status: "pending",
    });
  });

  it("rejects when the insert returns an error", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });

    await expect(
      addPatient(client, CTX, { name: "Jane" }),
    ).rejects.toThrow(/addPatient failed/);
  });
});
