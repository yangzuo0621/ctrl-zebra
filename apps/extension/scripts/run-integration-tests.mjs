import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(extensionDevelopmentPath, "..", "..");
const extensionTestsPath = resolve(extensionDevelopmentPath, "dist", "test", "suite", "index.cjs");
const ollamaSmokeModel = process.env.CTRL_ZEBRA_OLLAMA_SMOKE_MODEL;
const marketplaceSmoke = process.env.CTRL_ZEBRA_MARKETPLACE_SMOKE;
const launchArgs = [
  repositoryRoot,
  "--disable-extensions",
  "--skip-welcome",
  "--skip-release-notes",
];
const extensionTestsEnv = {
  ...(ollamaSmokeModel === undefined ? {} : { CTRL_ZEBRA_OLLAMA_SMOKE_MODEL: ollamaSmokeModel }),
  ...(marketplaceSmoke === undefined ? {} : { CTRL_ZEBRA_MARKETPLACE_SMOKE: marketplaceSmoke }),
};

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv,
    launchArgs,
    version: "1.125.0",
  });
} catch (error) {
  console.error("Extension integration tests failed.", error);
  process.exitCode = 1;
}
