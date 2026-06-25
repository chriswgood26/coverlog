import { describe, it, expect, vi } from "vitest";

// Mock next/headers so createServerSupabase() can run outside the Next.js runtime.
// The mock must be declared before the module under test is imported.
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

describe("createServerSupabase()", () => {
  it("returns a real Supabase client with .from() and .auth.getUser()", async () => {
    // Dynamic import placed after vi.mock so the mock is active when the
    // module resolves next/headers.
    const { createServerSupabase } = await import("../../src/lib/supabase/server");
    const client = await createServerSupabase();

    // If the factory is broken (returns undefined, throws, etc.) these fail.
    expect(typeof client.from).toBe("function");
    expect(typeof client.auth.getUser).toBe("function");
  });
});

describe("proxy config", () => {
  it("exports a config.matcher array", async () => {
    // Import the config export only — avoids executing next/server edge runtime
    // in the vitest node environment while still validating the contract.
    const proxyModule = await import("../../proxy");
    expect(Array.isArray(proxyModule.config.matcher)).toBe(true);
    expect(proxyModule.config.matcher.length).toBeGreaterThan(0);
  });
});
