import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./scripts/restate-register.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/@campuspilot\/.*/],
  },
});
