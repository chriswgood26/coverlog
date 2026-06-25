import { describe, it, expect } from "vitest";
import { getStaffContext } from "@/lib/auth/context";

function fakeClient(user: any, staffRow: any) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      async maybeSingle() { return { data: staffRow, error: null }; },
    }),
  } as any;
}

describe("getStaffContext", () => {
  it("returns orgId/staffId/role for a logged-in staff member", async () => {
    const client = fakeClient(
      { id: "user-1" },
      { id: "staff-1", org_id: "org-1", role: "admin" },
    );
    expect(await getStaffContext(client)).toEqual({
      orgId: "org-1", staffId: "staff-1", role: "admin",
    });
  });

  it("returns null when there is no session user", async () => {
    const client = fakeClient(null, null);
    expect(await getStaffContext(client)).toBeNull();
  });

  it("returns null when the user has no staff row", async () => {
    const client = fakeClient({ id: "user-1" }, null);
    expect(await getStaffContext(client)).toBeNull();
  });
});
