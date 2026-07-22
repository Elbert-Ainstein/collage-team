import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Vitest runs the rule/store tests independently of Next (no JSX rendering in the
// suite — pure services + store). Alias mirrors tsconfig paths.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
});
