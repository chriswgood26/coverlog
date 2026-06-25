import { describe, it, expect } from "vitest";

// Ensures the server-actions module and its lib imports resolve and type-check
// at runtime (catches a broken import path or renamed export before build).
describe("patients actions module", () => {
  it("exports the four server actions", async () => {
    const mod = await import("@/app/(app)/patients/actions");
    for (const fn of ["addPatientAction", "logCheckAction", "importCsvAction", "exportCsvAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});
