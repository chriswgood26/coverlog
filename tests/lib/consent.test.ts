import { describe, it, expect } from "vitest";
import { hasValidConsent } from "@/lib/phi/consent";

function client(row: any) {
  return { from: () => ({
    select() { return this; }, eq() { return this; }, is() { return this; },
    not() { return this; }, gt() { return this; }, or() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: row, error: null }; },
  }) } as any;
}

describe("hasValidConsent", () => {
  it("true when a granted, non-revoked, unexpired consent exists", async () => {
    expect(await hasValidConsent(client({ id: "c1" }), "p1")).toBe(true);
  });
  it("false when no qualifying consent row", async () => {
    expect(await hasValidConsent(client(null), "p1")).toBe(false);
  });
});
