import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import yauzl from "yauzl";
import {
  expectedSelectedFiles,
  validateArchiveEntries,
  validateBuildMetadata,
  validateReleaseDocuments,
  validateSelectedFiles,
} from "../apps/extension/scripts/vsix-policy.mjs";
import {
  assertDependencyInventoryMatches,
  createDependencyInventoryFile,
  createSpdxDocument,
  resolveBuildSource,
  validateBuildProvenance,
  validateCompatibleLicenses,
  validateDependencyInventoryFile,
  validatePublishPreconditions,
  validateReleaseSource,
  validateSpdxDocument,
  validateTagAvailability,
  validateVersionConsistency,
  validateVsixDependencyAudit,
} from "./release-policy.mjs";

const execFileAsync = promisify(execFile);
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsDirectory, "..");
const extensionRoot = join(repositoryRoot, "apps", "extension");
const manifest = await readJson(join(extensionRoot, "package.json"));
const args = parseArguments(process.argv.slice(2));

const lockfile = await readFile(join(repositoryRoot, "pnpm-lock.yaml"), "utf8");
const changelog = await readFile(join(repositoryRoot, "CHANGELOG.md"), "utf8");
const releaseDocument = await readFile(join(repositoryRoot, "docs", "release.md"), "utf8");
const commit = (await git(["rev-parse", "HEAD"])).trim();
const version = String(manifest.version);
const tag =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF?.replace("refs/tags/", "")
    : undefined;
const branch =
  process.env.GITHUB_ACTIONS === "true"
    ? undefined
    : (await git(["branch", "--show-current"])).trim();
const localTag =
  process.env.GITHUB_ACTIONS === "true" || branch
    ? undefined
    : (await git(["describe", "--tags", "--exact-match", "HEAD"])).trim();

if (process.env.GITHUB_ACTIONS === "true") {
  validateReleaseSource(process.env, { version });
  if (process.env.GITHUB_SHA !== commit) {
    throw new Error("GitHub Actions source SHA does not match the checked-out commit.");
  }
}
const source = resolveBuildSource({
  environment: process.env,
  version,
  branch,
  tag: localTag,
});
const effectiveTag = tag ?? localTag;

validateVersionConsistency({
  version,
  extensionVersion: manifest.version,
  tag: effectiveTag,
  changelog,
  lockfile,
  extensionManifest: manifest,
  releaseDocument,
  requireReleaseNotes: Boolean(effectiveTag),
});
validateReleaseDocuments({
  rootReadme: await readFile(join(repositoryRoot, "README.md"), "utf8"),
  extensionReadme: await readFile(join(extensionRoot, "README.md"), "utf8"),
  rootLicense: await readFile(join(repositoryRoot, "LICENSE"), "utf8"),
  extensionLicense: await readFile(join(extensionRoot, "LICENSE"), "utf8"),
});

const inventory = await collectProductionDependencies();
validateCompatibleLicenses(inventory);
const inventoryFile = createDependencyInventoryFile({ commit, version, packages: inventory });
validateDependencyInventoryFile(inventoryFile, { version, sourceCommit: commit });
const sbom = createSpdxDocument({ name: "ctrl-zebra", version, packages: inventory });
validateSpdxDocument(sbom, inventory);

const declaredInventory = await readOptionalJson(
  join(repositoryRoot, "release", "third-party-dependencies.json"),
);
if (declaredInventory && !args.updateAudit) {
  validateDependencyInventoryFile(declaredInventory, { version });
  try {
    await git(["merge-base", "--is-ancestor", declaredInventory.sourceCommit, commit]);
  } catch {
    throw new Error(
      "Third-party dependency inventory sourceCommit is not an ancestor of the checkout.",
    );
  }
  assertDependencyInventoryMatches(inventory, declaredInventory.packages);
}
const declaredSbom = await readOptionalJson(join(repositoryRoot, "release", "sbom.spdx.json"));
if (declaredSbom && !args.updateAudit) {
  validateSpdxDocument(declaredSbom, inventory);
  if (JSON.stringify(declaredSbom) !== JSON.stringify(sbom)) {
    throw new Error("Release SBOM differs from the generated dependency inventory.");
  }
}

const outputDirectory = resolve(repositoryRoot, args.output ?? ".artifacts/release");
await mkdir(outputDirectory, { recursive: true });
await writeJson(join(outputDirectory, "third-party-dependencies.json"), inventoryFile);
await writeJson(join(outputDirectory, "sbom.spdx.json"), sbom);

let artifactReport;
if (args.artifact) {
  artifactReport = await inspectArtifact(resolveArtifact(args.artifact), inventory);
  await writeJson(join(outputDirectory, "vsix-provenance.json"), artifactReport);
}

if (args.updateAudit) {
  await mkdir(join(repositoryRoot, "release"), { recursive: true });
  await writeJson(join(repositoryRoot, "release", "third-party-dependencies.json"), inventoryFile);
  await writeJson(join(repositoryRoot, "release", "sbom.spdx.json"), sbom);
}

if (args.publish || args.cancelled) {
  validatePublishPreconditions({
    publish: args.publish || args.cancelled,
    cancelled: args.cancelled,
    environment: process.env.RELEASE_ENVIRONMENT,
    token: process.env.VSCE_PAT,
  });
}

if (args.assertTagFree) {
  const existingTags = (await git(["tag", "--list"])).split(/\r?\n/u).filter(Boolean);
  validateTagAvailability(`v${version}`, existingTags);
}

console.log(
  JSON.stringify(
    {
      version,
      commit,
      artifact: artifactReport,
      dependencyCount: inventory.length,
      sbom: join(outputDirectory, "sbom.spdx.json"),
    },
    null,
    2,
  ),
);

async function collectProductionDependencies() {
  const tree = JSON.parse(
    await runPnpm(["--dir", "apps/extension", "list", "--prod", "--json", "--depth", "Infinity"]),
  );
  const extensionNode = findNodeByPath(tree, extensionRoot);
  if (!extensionNode) {
    throw new Error("pnpm did not return the extension production dependency graph.");
  }
  const packages = new Map();
  visit(extensionNode, true);
  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en"),
  );

  function visit(node, root) {
    if (!node || typeof node !== "object") {
      return;
    }
    const packageName = node.name ?? node.from;
    if (!root && typeof packageName === "string" && typeof node.version === "string" && node.path) {
      const packageJson = readPackageJsonSync(node.path);
      const relativePath = relative(repositoryRoot, node.path);
      const isWorkspacePackage =
        !relativePath.startsWith("..") && !relativePath.includes("node_modules");
      if (!packageJson.private && !isWorkspacePackage) {
        const license = packageJson.license ?? packageJson.licenses;
        if (!license) {
          throw new Error(
            `Production dependency has no declared license: ${packageName}@${node.version}.`,
          );
        }
        packages.set(`${packageName}@${node.version}`, {
          name: packageName,
          version: node.version,
          license,
          ...(node.resolved ? { resolved: node.resolved } : {}),
        });
      }
    }
    for (const dependency of Object.values(node.dependencies ?? {})) {
      visit(dependency, false);
    }
  }
}

async function inspectArtifact(artifactPath, inventory) {
  const archiveStat = await stat(artifactPath);
  const zipFile = await yauzl.openPromise(artifactPath, {
    lazyEntries: true,
    validateEntrySizes: true,
  });
  const entries = [];
  let packagedMetadata;
  let packagedManifest;
  for await (const entry of zipFile.eachEntry()) {
    entries.push({ fileName: entry.fileName, uncompressedSize: entry.uncompressedSize });
    if (entry.fileName === "extension/dist/package/build-metadata.json") {
      packagedMetadata = JSON.parse(await readSmallEntry(zipFile, entry, 8192));
    }
    if (entry.fileName === "extension/package.json") {
      packagedManifest = JSON.parse(await readSmallEntry(zipFile, entry, 1024 * 1024));
    }
  }

  const inspection = validateArchiveEntries(entries, archiveStat.size);
  validateBuildMetadata(packagedMetadata, { commit, version });
  validateBuildProvenance(packagedMetadata, {
    commit,
    version,
    lockfileSha256: sha256(lockfile),
    changelogSha256: sha256(changelog),
    sourceRef: source.sourceRef,
    sourceRefType: source.sourceRefType,
  });
  validateSelectedFiles([...expectedSelectedFiles]);
  validateVsixDependencyAudit({
    archiveEntries: entries,
    extensionManifest: packagedManifest,
    declaredDependencies: Object.keys(manifest.dependencies ?? {}),
  });
  return {
    path: artifactPath,
    sha256: await sha256File(artifactPath),
    ...inspection,
    sourceCommit: packagedMetadata.commit,
    sourceRef: packagedMetadata.sourceRef,
    sourceRefType: packagedMetadata.sourceRefType,
    version: packagedMetadata.version,
    dependencyCount: inventory.length,
  };
}

function parseArguments(argv) {
  const parsed = {
    artifact: undefined,
    output: undefined,
    updateAudit: false,
    publish: false,
    cancelled: false,
    assertTagFree: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifact") {
      parsed.artifact = argv[++index];
    } else if (argument === "--output") {
      parsed.output = argv[++index];
    } else if (argument === "--update-audit") {
      parsed.updateAudit = true;
    } else if (argument === "--publish") {
      parsed.publish = true;
    } else if (argument === "--cancelled") {
      parsed.cancelled = true;
    } else if (argument === "--assert-tag-free") {
      parsed.assertTagFree = true;
    } else if (argument !== "--") {
      throw new Error(`Unknown release verification argument: ${argument}`);
    }
  }
  if (parsed.publish && parsed.cancelled) {
    throw new Error("Release publishing cannot be both requested and cancelled.");
  }
  return parsed;
}

function findNodeByPath(value, expectedPath) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findNodeByPath(entry, expectedPath);
      if (match) {
        return match;
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (value.path && resolve(value.path) === resolve(expectedPath)) {
    return value;
  }
  for (const child of Object.values(value)) {
    const match = findNodeByPath(child, expectedPath);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function readPackageJsonSync(packagePath) {
  // pnpm list already supplied the path. The synchronous read keeps the recursive
  // inventory walk deterministic and bounded; no package content is emitted.
  return JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  const json = JSON.stringify(value, null, 2).replace(
    /("creators":) \[\n\s+"([^"\n]+)"\n\s+\]/gu,
    '$1 ["$2"]',
  );
  await writeFile(filePath, `${json}\n`, "utf8");
}

function resolveArtifact(value) {
  if (!value) {
    throw new Error("--artifact requires a VSIX path.");
  }
  return isAbsolute(value) ? value : resolve(repositoryRoot, value);
}

async function git(args) {
  return run("git", args, repositoryRoot);
}

async function run(executable, args, cwd) {
  const result = await execFileAsync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout;
}

async function runPnpm(args) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], repositoryRoot);
  }
  return run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, repositoryRoot);
}

async function readSmallEntry(zipFile, entry, limit) {
  if (entry.uncompressedSize > limit) {
    throw new Error(`VSIX metadata exceeds the ${limit}-byte limit.`);
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      throw new Error(`VSIX metadata exceeds the ${limit}-byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}
