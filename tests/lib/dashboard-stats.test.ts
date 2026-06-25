import { describe, it, expect } from "vitest";
import { getDashboardStats } from "@/lib/dashboard/stats";

// Fake client: rpc("dashboard_stats") returns the single-row table result.
function client(row: { verified_today: number; due_this_week: number; needs_attention: number }) {
  return {
    rpc: async (_fn: string) => ({ data: [row], error: null }),
  } as any;
}

describe("getDashboardStats", () => {
  it("returns the three counts", async () => {
    const stats = await getDashboardStats(
      client({ verified_today: 2, due_this_week: 5, needs_attention: 9 }),
    );
    expect(stats).toEqual({ verifiedToday: 2, dueThisWeek: 5, needsAttention: 9 });
  });
});
