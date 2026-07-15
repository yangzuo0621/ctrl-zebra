import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["packages/*/src/**/*.test.ts", "apps/extension/src/controllers/**/*.test.ts"],
    passWithNoTests: false,
  },
});
