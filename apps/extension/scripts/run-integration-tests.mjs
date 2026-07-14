import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionTestsPath = resolve(extensionDevelopmentPath, "dist", "test", "suite", "index.cjs");

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ["--disable-extensions", "--skip-welcome", "--skip-release-notes"],
    version: "1.125.0",
  });
} catch (error) {
  console.error("Extension integration tests failed.", error);
  process.exitCode = 1;
}
