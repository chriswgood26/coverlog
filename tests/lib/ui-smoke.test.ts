import { describe, it, expect } from "vitest";
import { statusColor } from "@/components/ui/Badge";

describe("statusColor", () => {
  it("maps known statuses to Kinship palette classes", () => {
    expect(statusColor("verified")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("enrolled")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("active")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("in_network")).toBe("bg-emerald-100 text-emerald-700");
    expect(statusColor("pending")).toBe("bg-amber-100 text-amber-700");
    expect(statusColor("out_of_network")).toBe("bg-amber-100 text-amber-700");
    expect(statusColor("expired")).toBe("bg-amber-100 text-amber-700");
    expect(statusColor("inactive")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("terminated")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("not_enrolled")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("revoked")).toBe("bg-slate-100 text-slate-500");
    expect(statusColor("expiring")).toBe("bg-amber-100 text-amber-700");
    expect(statusColor("denied")).toBe("bg-red-100 text-red-600");
    expect(statusColor("flagged")).toBe("bg-red-100 text-red-600");
    expect(statusColor("admin")).toBe("bg-purple-100 text-purple-700");
    expect(statusColor("specialist")).toBe("bg-slate-100 text-slate-600");
  });
  it("falls back to a neutral class for unknown values", () => {
    expect(statusColor("whatever")).toBe("bg-slate-100 text-slate-600");
  });
});

describe("ui modules import", () => {
  it("ui.ts exports class constants", async () => {
    const ui = await import("@/lib/ui");
    for (const k of ["btnPrimary", "btnSecondary", "card", "inputClass", "labelClass", "tableWrap", "thCell"]) {
      expect(typeof (ui as any)[k]).toBe("string");
    }
  });
  it("Badge/PageHeader/Card modules export components", async () => {
    expect(typeof (await import("@/components/ui/Badge")).Badge).toBe("function");
    expect(typeof (await import("@/components/ui/PageHeader")).PageHeader).toBe("function");
    expect(typeof (await import("@/components/ui/Card")).Card).toBe("function");
  });
});
