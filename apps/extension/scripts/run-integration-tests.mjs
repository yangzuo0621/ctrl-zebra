import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionTestsPath = resolve(extensionDevelopmentPath, "dist", "test", "suite", "index.cjs");
const ollamaSmokeModel = process.env.CTRL_ZEBRA_OLLAMA_SMOKE_MODEL;
const launchArgs = ["--disable-extensions", "--skip-welcome", "--skip-release-notes"];
const ollamaSmokeEnvironment =
  ollamaSmokeModel === undefined
    ? {}
    : { extensionTestsEnv: { CTRL_ZEBRA_OLLAMA_SMOKE_MODEL: ollamaSmokeModel } };

if (ollamaSmokeModel !== undefined) {
  launchArgs.unshift(resolve(extensionDevelopmentPath, "..", ".."));
}

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    ...ollamaSmokeEnvironment,
    launchArgs,
    version: "1.125.0",
  });
} catch (error) {
  console.error("Extension integration tests failed.", error);
  process.exitCode = 1;
}
