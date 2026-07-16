import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
          include: ["apps/webview/src/**/*.test.tsx"],
          setupFiles: ["apps/webview/src/test-setup.ts"],
        },
      },
    ],
    passWithNoTests: false,
  },
});
