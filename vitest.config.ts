import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Next's tsconfig says `jsx: "preserve"`, which would leave JSX untransformed for
  // the component tests; the automatic runtime compiles it without needing
  // @vitejs/plugin-react. This Vite is the rolldown/oxc variant, where the `oxc`
  // option is the transform knob (its esbuild equivalent is ignored with a warning).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // Node by default; the component tests opt into jsdom per file via the
    // `// @vitest-environment jsdom` docblock pragma (Vitest 4 removed
    // environmentMatchGlobs), so every pre-existing node test runs untouched.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  }
});
