import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import yauzl from "yauzl";

import {
  assertCleanStatus,
  validateArchiveEntries,
  validateBuildMetadata,
  validateGitHubActionsSource,
  validateReleaseDocuments,
  validateSelectedFiles,
} from "./vsix-policy.mjs";

const execFileAsync = promisify(execFile);
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptsDirectory, "..");
const repositoryRoot = resolve(extensionRoot, "..", "..");
const manifest = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));

assertCleanStatus(await git(["status", "--porcelain=v1", "--untracked-files=all"]));
validateReleaseDocuments({
  rootReadme: await readFile(join(repositoryRoot, "README.md"), "utf8"),
  extensionReadme: await readFile(join(extensionRoot, "README.md"), "utf8"),
  rootLicense: await readFile(join(repositoryRoot, "LICENSE"), "utf8"),
  extensionLicense: await readFile(join(extensionRoot, "LICENSE"), "utf8"),
});
const commit = (await git(["rev-parse", "HEAD"])).trim();
const isGitHubActionsSource = validateGitHubActionsSource(process.env, {
  commit,
  version: manifest.version,
});
if (!isGitHubActionsSource) {
  const upstream = (
    await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  ).trim();
  await git(["merge-base", "--is-ancestor", "HEAD", upstream]);
}

for (const command of ["check", "typecheck", "test:unit", "test:integration", "build"]) {
  await pnpm([command]);
}

const metadata = { commit, version: manifest.version };
const metadataPath = join(extensionRoot, "dist", "package", "build-metadata.json");
await mkdir(dirname(metadataPath), { recursive: true });
await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, "utf8");

const selectedOutput = await vsce(["ls", "--no-dependencies"]);
const selectedFiles = selectedOutput
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean);
validateSelectedFiles(selectedFiles);

const artifactDirectory = join(repositoryRoot, ".artifacts");
const artifactPath = join(
  artifactDirectory,
  `${manifest.name}-${manifest.version}-${commit.slice(0, 12)}.vsix`,
);
await mkdir(artifactDirectory, { recursive: true });
await vsce(["package", "--no-dependencies", "--out", artifactPath]);

const inspection = await inspectVsix(artifactPath, metadata);
assertCleanStatus(await git(["status", "--porcelain=v1", "--untracked-files=no"]));

console.log(
  JSON.stringify(
    {
      artifactPath,
      commit,
      version: manifest.version,
      ...inspection,
    },
    null,
    2,
  ),
);

async function inspectVsix(artifactPath, expectedMetadata) {
  const archiveStat = await stat(artifactPath);
  const zipFile = await yauzl.openPromise(artifactPath, {
    lazyEntries: true,
    validateEntrySizes: true,
  });
  const entries = [];
  let packagedMetadata;

  for await (const entry of zipFile.eachEntry()) {
    entries.push({ fileName: entry.fileName, uncompressedSize: entry.uncompressedSize });
    if (entry.fileName === "extension/dist/package/build-metadata.json") {
      packagedMetadata = JSON.parse(await readSmallEntry(zipFile, entry, 4096));
    }
  }

  const sizes = validateArchiveEntries(entries, archiveStat.size);
  validateBuildMetadata(packagedMetadata, expectedMetadata);
  return sizes;
}

async function readSmallEntry(zipFile, entry, limit) {
  if (entry.uncompressedSize > limit) {
    throw new Error(`Build metadata exceeds the ${limit}-byte limit.`);
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      throw new Error(`Build metadata exceeds the ${limit}-byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

async function git(args) {
  return run("git", args, repositoryRoot);
}

async function pnpm(args) {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) {
    throw new Error("Run the official packaging command through pnpm.");
  }
  return run(process.execPath, [pnpmCli, ...args], repositoryRoot);
}

async function vsce(args) {
  const vsceCli = join(repositoryRoot, "node_modules", "@vscode", "vsce", "vsce");
  return run(process.execPath, [vsceCli, ...args], extensionRoot);
}

async function run(executable, args, cwd) {
  const result = await execFileAsync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.stdout) {
    process.stderr.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.stdout;
}
