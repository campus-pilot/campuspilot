import { defineConfig } from "vitest/config";

// Unit tests for the Hono helpers. No infra: `resolveClientIp` is pure header
// parsing, exercised through a real Hono request so header handling is the
// framework's, not a stub's.
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
