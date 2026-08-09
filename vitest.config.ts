import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", ["json-summary", { file: "coverage-summary.json" }]],
      include: [
        "packages/*/src/**/*.{ts,tsx}",
        "apps/extension/src/**/*.{ts,tsx}",
        "apps/webview/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/test/**",
        "**/fixtures/**",
        "**/test-setup.{ts,tsx}",
        "**/*.d.ts",
      ],
      // 2026-08-09 aggregate baseline (node + jsdom) was 82.14/77.30/78.73/82.49
      // for statements/branches/functions/lines; each gate is one point lower.
      thresholds: {
        statements: 81,
        branches: 76,
        functions: 77,
        lines: 81,
      },
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          globals: false,
          include: [
            "packages/*/src/**/*.test.ts",
            "apps/extension/src/{adapters,controllers}/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "webview",
          environment: "jsdom",
          globals: false,
          include: ["apps/webview/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/webview/src/test-setup.ts"],
        },
      },
    ],
    passWithNoTests: false,
  },
});
