import { defineConfig } from "vitest/config";
/**
 * Model tests run in node. Component tests (`*.test.tsx`) opt into jsdom
 * with a `@vitest-environment jsdom` comment.
 */
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
