import { describe, it, expect } from "vitest";
describe("payers actions module", () => {
  it("exports the two override server actions", async () => {
    const mod = await import("@/app/(app)/payers/actions");
    for (const fn of ["saveOrgCoverageAction", "saveOrgClaimRuleAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
