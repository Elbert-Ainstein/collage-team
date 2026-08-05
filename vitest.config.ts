import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Unit tests for the Class Check-ins app. Mostly pure logic; a few mount a
// component to pin behaviour that only shows up once it renders.
// Alias mirrors tsconfig paths.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // The automatic runtime, matching next.js — so a .tsx test doesn't have to
  // import React just to satisfy the transform.
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
