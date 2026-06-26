import { describe, it, expect } from "vitest";

describe("admin actions module", () => {
  it("exports the staff admin server actions", async () => {
    const mod = await import("@/app/(app)/admin/actions");
    for (const fn of ["setStaffRoleAction", "deactivateStaffAction", "reactivateStaffAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
