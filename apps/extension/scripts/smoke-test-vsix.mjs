import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";

const execFileAsync = promisify(execFile);
const vscodeVersion = "1.125.0";
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptsDirectory, "..");
const repositoryRoot = resolve(extensionRoot, "..", "..");
const harnessRoot = join(scriptsDirectory, "vsix-smoke-harness");
const manifest = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));
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
  const vscodeExecutablePath = await downloadAndUnzipVSCode(vscodeVersion);
  await runVsCodeCli(vscodeExecutablePath, [
    "--install-extension",
    artifactPath,
    "--force",
    "--extensions-dir",
    extensionsDirectory,
    "--user-data-dir",
    userDataDirectory,
  ]);

  const listed = await runVsCodeCli(vscodeExecutablePath, [
    "--list-extensions",
    "--show-versions",
    "--extensions-dir",
    extensionsDirectory,
    "--user-data-dir",
    userDataDirectory,
  ]);
  const expectedExtension = `${manifest.publisher}.${manifest.name}@${manifest.version}`;
  if (!listed.stdout.split(/\r?\n/u).includes(expectedExtension)) {
    throw new Error("The isolated VS Code profile did not list the packaged CtrlZebra extension.");
  }

  await runTests({
    vscodeExecutablePath,
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

async function runVsCodeCli(vscodeExecutablePath, args) {
  let executable = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
  let prefixArguments = [];
  let environment = process.env;

  if (process.platform === "win32") {
    executable = vscodeExecutablePath;
    prefixArguments = [await findWindowsCliModule(dirname(vscodeExecutablePath))];
    environment = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  }

  return execFileAsync(executable, [...prefixArguments, ...args], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

async function findWindowsCliModule(vscodeRoot) {
  const matches = [];
  for (const entry of await readdir(vscodeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = join(vscodeRoot, entry.name, "resources", "app", "out", "cli.js");
    try {
      await access(candidate);
      matches.push(candidate);
    } catch {
      // A VS Code archive contains many directories; only its commit directory owns cli.js.
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one VS Code CLI module, found ${matches.length}.`);
  }
  return matches[0];
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
