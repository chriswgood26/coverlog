import { describe, it, expect } from "vitest";
import { getDashboardStats } from "@/lib/dashboard/stats";

// Fake client: every terminal query resolves to a fixed count; capture which filters ran.
function client(counts: number[]) {
  let i = 0;
  const make = () => {
    const chain: any = {};
    for (const m of ["select", "is", "eq", "gte", "lte", "in"]) chain[m] = () => chain;
    chain.then = (r: any) => r({ count: counts[i++], error: null });
    return chain;
  };
  return { from: () => make() } as any;
}

describe("getDashboardStats", () => {
  it("returns the three counts", async () => {
    const stats = await getDashboardStats(client([2, 5, 9]));
    expect(stats).toEqual({ verifiedToday: 2, dueThisWeek: 5, needsAttention: 9 });
  });
});
