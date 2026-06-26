import { describe, it, expect } from "vitest";

describe("admin actions module", () => {
  it("exports the staff admin server actions", async () => {
    const mod = await import("@/app/(app)/admin/actions");
    for (const fn of ["setStaffRoleAction", "deactivateStaffAction", "reactivateStaffAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});

describe("patient consent actions module", () => {
  it("exports grantConsentAction + revokeConsentAction", async () => {
    const mod = await import("@/app/(app)/patients/actions");
    for (const fn of ["grantConsentAction", "revokeConsentAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
