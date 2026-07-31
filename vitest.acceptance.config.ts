import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * The DB-backed acceptance suite (`docs/testing-and-acceptance.md` § "Implementation
 * acceptance suite"), kept separate from `npm run test` on purpose: the unit gate must
 * stay runnable with no database, while this config requires PostgreSQL.
 *
 * Run with `npm run test:acceptance`. The global setup creates (if needed) and
 * migrates a dedicated `qams_test` database — never the development `qams` database —
 * and every test file truncates all tables before it seeds, so nothing here can
 * touch development data.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/acceptance/**/*.test.ts"],
    globalSetup: ["tests/acceptance/global-setup.ts"],
    setupFiles: ["tests/acceptance/setup-env.ts"],
    // One database, so one worker: parallel files would truncate each other's data.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  }
});
