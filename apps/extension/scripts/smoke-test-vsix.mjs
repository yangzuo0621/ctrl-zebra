import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runTests, runVSCodeCommand } from "@vscode/test-electron";

const vscodeVersion = "1.125.0";
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptsDirectory, "..");
const repositoryRoot = resolve(extensionRoot, "..", "..");
const harnessRoot = join(scriptsDirectory, "vsix-smoke-harness");
const artifactArgument = process.argv[2];

if (!artifactArgument) {
  throw new Error("Usage: pnpm smoke:vsix -- <absolute-or-repository-relative-vsix-path>");
}

const artifactPath = resolve(repositoryRoot, artifactArgument);
await access(artifactPath);

const temporaryRoot = resolve(tmpdir());
const profileRoot = await mkdtemp(join(temporaryRoot, "ctrl-zebra-vsix-smoke-"));
if (!profileRoot.startsWith(`${temporaryRoot}${sep}`)) {
  throw new Error("Refusing to use a smoke-test directory outside the operating-system temp root.");
}

const extensionsDirectory = join(profileRoot, "extensions");
const userDataDirectory = join(profileRoot, "user-data");

try {
  await runVSCodeCommand(
    [
      "--install-extension",
      artifactPath,
      "--force",
      "--extensions-dir",
      extensionsDirectory,
      "--user-data-dir",
      userDataDirectory,
    ],
    { version: vscodeVersion },
  );

  const listed = await runVSCodeCommand(
    [
      "--list-extensions",
      "--show-versions",
      "--extensions-dir",
      extensionsDirectory,
      "--user-data-dir",
      userDataDirectory,
    ],
    { version: vscodeVersion },
  );
  if (!listed.stdout.split(/\r?\n/u).includes("ctrl-zebra.ctrl-zebra@0.0.0")) {
    throw new Error("The isolated VS Code profile did not list the packaged CtrlZebra extension.");
  }

  await runTests({
    version: vscodeVersion,
    extensionDevelopmentPath: harnessRoot,
    extensionTestsPath: join(harnessRoot, "suite.cjs"),
    launchArgs: [
      repositoryRoot,
      "--skip-welcome",
      "--skip-release-notes",
      "--extensions-dir",
      extensionsDirectory,
      "--user-data-dir",
      userDataDirectory,
    ],
  });

  const logPath = await findFile(userDataDirectory, "CtrlZebra.log");
  const log = await readFile(logPath, "utf8");
  for (const event of ["extension_activated", "agent_view_first_displayed"]) {
    if (!log.includes(`"event":"${event}"`)) {
      throw new Error(`Installed-extension smoke log is missing ${event}.`);
    }
  }

  console.log(`VSIX smoke test passed for ${artifactPath}`);
} finally {
  await rm(profileRoot, { recursive: true, force: true });
}

async function findFile(directory, fileName) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      try {
        return await findFile(entryPath, fileName);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== `Could not find ${fileName}.`) {
          throw error;
        }
      }
    } else if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
  }
  throw new Error(`Could not find ${fileName}.`);
}
