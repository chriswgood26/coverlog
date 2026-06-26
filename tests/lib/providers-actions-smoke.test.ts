import { describe, it, expect } from "vitest";
describe("providers actions module", () => {
  it("exports the provider server actions", async () => {
    const mod = await import("@/app/(app)/providers/actions");
    for (const fn of ["createProviderAction", "deleteProviderAction"]) {
      expect(typeof (mod as any)[fn]).toBe("function");
    }
  });
});

describe("enrollment + patient-link actions", () => {
  it("payers actions export saveEnrollmentAction", async () => {
    const mod = await import("@/app/(app)/payers/actions");
    expect(typeof (mod as any).saveEnrollmentAction).toBe("function");
  });
  it("patients actions export linkPatientPayerAction", async () => {
    const mod = await import("@/app/(app)/patients/actions");
    expect(typeof (mod as any).linkPatientPayerAction).toBe("function");
  });
});
