import { describe, it, expect } from "vitest";
describe("providers actions module", () => {
  it("exports the provider server actions", async () => {
    const mod = await import("@/app/(app)/providers/actions");
    for (const fn of ["createProviderAction", "deleteProviderAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
