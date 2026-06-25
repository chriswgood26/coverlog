import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // DB-backed tests share ONE hosted Supabase database and each truncates/seeds
    // the same tables in beforeAll. Running test files in parallel causes
    // concurrent-TRUNCATE deadlocks and cross-file interference, so run files
    // serially. (Each file still gets its own isolated module/pool instance.)
    fileParallelism: false,
  },
});
