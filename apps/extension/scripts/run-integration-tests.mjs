import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
const performanceBenchmark = process.env.CTRL_ZEBRA_PERFORMANCE_BENCHMARK === "1";
let benchmarkUserDataDirectory;
if (performanceBenchmark) {
  benchmarkUserDataDirectory = await mkdtemp(join(tmpdir(), "ctrl-zebra-performance-profile-"));
  launchArgs.push("--user-data-dir", benchmarkUserDataDirectory);
}
const extensionTestsEnv = {
  ...(ollamaSmokeModel === undefined ? {} : { CTRL_ZEBRA_OLLAMA_SMOKE_MODEL: ollamaSmokeModel }),
  ...(marketplaceSmoke === undefined ? {} : { CTRL_ZEBRA_MARKETPLACE_SMOKE: marketplaceSmoke }),
  ...(process.env.CTRL_ZEBRA_PERFORMANCE_BENCHMARK === undefined
    ? {}
    : {
        CTRL_ZEBRA_PERFORMANCE_BENCHMARK: process.env.CTRL_ZEBRA_PERFORMANCE_BENCHMARK,
        CTRL_ZEBRA_PERFORMANCE_OUTPUT: process.env.CTRL_ZEBRA_PERFORMANCE_OUTPUT,
        CTRL_ZEBRA_PERFORMANCE_RESULT: process.env.CTRL_ZEBRA_PERFORMANCE_RESULT,
        CTRL_ZEBRA_REPOSITORY_ROOT: repositoryRoot,
        CTRL_ZEBRA_NODE_EXECUTABLE: process.execPath,
      }),
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
} finally {
  if (benchmarkUserDataDirectory !== undefined) {
    await rm(benchmarkUserDataDirectory, { recursive: true, force: true });
  }
}
