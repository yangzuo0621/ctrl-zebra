import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(repositoryRoot, "apps", "extension");
const manifest = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));
const rootReadme = await readFile(join(repositoryRoot, "README.md"), "utf8");
const extensionReadme = await readFile(join(extensionRoot, "README.md"), "utf8");
const smokeWorkflow = await readFile(
  join(repositoryRoot, ".github", "workflows", "marketplace-smoke.yml"),
  "utf8",
);

const screenshotFiles = [
  "media/marketplace/agent-overview.png",
  "media/marketplace/provider-setup.png",
  "media/marketplace/safe-tools.png",
];

assertString(manifest.name, "manifest.name");
assertString(manifest.displayName, "manifest.displayName");
assertString(manifest.description, "manifest.description");
if (manifest.description.length > 200) {
  throw new Error("Marketplace description must not exceed 200 characters.");
}
if (manifest.license !== "MIT") {
  throw new Error("Marketplace metadata must declare the repository MIT license.");
}
if (manifest.icon !== "media/ctrl-zebra.png") {
  throw new Error("Marketplace metadata must use the reviewed CtrlZebra icon.");
}
if (manifest.markdown !== "github" || manifest.qna !== false) {
  throw new Error("Marketplace metadata must use GitHub Markdown rendering and disable Q&A.");
}
if (
  !isRecord(manifest.galleryBanner) ||
  !/^#[0-9a-f]{6}$/iu.test(manifest.galleryBanner.color) ||
  !["dark", "light"].includes(manifest.galleryBanner.theme)
) {
  throw new Error("Marketplace metadata must define a valid gallery banner color and theme.");
}
if (manifest.homepage !== "https://github.com/yangzuo0621/ctrl-zebra#readme") {
  throw new Error("Marketplace metadata homepage must point to the public README.");
}
if (manifest.bugs?.url !== "https://github.com/yangzuo0621/ctrl-zebra/issues") {
  throw new Error("Marketplace metadata must expose the public support issue tracker.");
}
if (manifest.repository?.url !== "https://github.com/yangzuo0621/ctrl-zebra.git") {
  throw new Error("Marketplace metadata repository must point to the public source repository.");
}

const packagedFiles = new Set(assertStringArray(manifest.files, "manifest.files"));
for (const fileName of [manifest.icon, ...screenshotFiles, "README.md", "LICENSE"]) {
  assertSafeRelativePath(fileName);
  if (!packagedFiles.has(fileName)) {
    throw new Error(`Marketplace file ${fileName} is missing from the VSIX allowlist.`);
  }
}
for (const fileName of packagedFiles) {
  assertSafeRelativePath(fileName);
  if (/(?:fixture|cache|private|secret|credential|\.env)/iu.test(fileName)) {
    throw new Error(`Marketplace VSIX allowlist contains a private-state path: ${fileName}`);
  }
}

if (rootReadme.length === 0 || rootReadme !== extensionReadme) {
  throw new Error(
    "Repository and packaged Marketplace README files must be identical and non-empty.",
  );
}
for (const requiredText of [
  "## Marketplace preview",
  "## Privacy, support, and release links",
  "Known limitations",
  "Desktop VS Code only",
  "[Privacy Notice](https://github.com/yangzuo0621/ctrl-zebra/blob/main/PRIVACY.md)",
  "[Support and bug reports](https://github.com/yangzuo0621/ctrl-zebra/issues)",
  "[Security Policy](https://github.com/yangzuo0621/ctrl-zebra/blob/main/SECURITY.md)",
  "[Contributing](https://github.com/yangzuo0621/ctrl-zebra/blob/main/CONTRIBUTING.md)",
  "[Changelog](https://github.com/yangzuo0621/ctrl-zebra/blob/main/CHANGELOG.md)",
  "Marketplace publication remains a separate release action",
]) {
  if (!rootReadme.includes(requiredText)) {
    throw new Error(`README is missing Marketplace-required content: ${requiredText}`);
  }
}
for (const pattern of [
  /(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}/u,
  /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/u,
]) {
  if (pattern.test(rootReadme)) {
    throw new Error("README contains a credential-like value or private local path.");
  }
}

const screenshots = [];
for (const fileName of screenshotFiles) {
  const bytes = await readFile(join(extensionRoot, fileName));
  const dimensions = readPngDimensions(bytes, fileName);
  if (bytes.byteLength > 2_500_000) {
    throw new Error(`Marketplace screenshot is unexpectedly large: ${fileName}`);
  }
  if (dimensions.width < 1_000 || dimensions.height < 600) {
    throw new Error(`Marketplace screenshot is too small for a listing: ${fileName}`);
  }
  screenshots.push({ file: fileName, ...dimensions, bytes: bytes.byteLength });
}

const icon = await readFile(join(extensionRoot, manifest.icon));
const iconDimensions = readPngDimensions(icon, manifest.icon);
if (iconDimensions.width !== 256 || iconDimensions.height !== 256) {
  throw new Error("Marketplace icon must remain the reviewed 256x256 PNG.");
}

for (const requiredText of [
  "workflow_dispatch:",
  "contents: read",
  "ubuntu-latest",
  "macos-latest",
  "windows-latest",
  'CTRL_ZEBRA_MARKETPLACE_SMOKE: "1"',
  "pnpm package:vsix",
  "pnpm smoke:vsix",
]) {
  if (!smokeWorkflow.includes(requiredText)) {
    throw new Error(`Marketplace smoke workflow is missing: ${requiredText}`);
  }
}
if (/pull_request_target|secrets\.|vsce\s+publish/iu.test(smokeWorkflow)) {
  throw new Error(
    "Marketplace smoke workflow must not use privileged triggers, secrets, or publish.",
  );
}
for (const line of smokeWorkflow.split(/\r?\n/u)) {
  const action = /^\s*uses:\s*(\S+)(?:\s+#\s*(\S+))?\s*$/u.exec(line);
  if (action === null) continue;
  if (!/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u.test(action[1] ?? "") || action[2] === undefined) {
    throw new Error(`Marketplace smoke Action is not pinned with an annotated SHA: ${line.trim()}`);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "passed",
      extension: manifest.name,
      version: manifest.version,
      metadata: ["icon", "galleryBanner", "markdown", "qna", "homepage", "bugs", "repository"],
      screenshots,
      workflowRunners: ["Linux", "macOS", "Windows"],
      privateStateIncluded: false,
    },
    null,
    2,
  )}\n`,
);

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function assertSafeRelativePath(fileName) {
  if (
    fileName === "" ||
    fileName.includes("\\") ||
    fileName.startsWith("/") ||
    /^[A-Za-z]:/u.test(fileName) ||
    fileName.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error(`Marketplace path is unsafe: ${fileName}`);
  }
}

function readPngDimensions(bytes, fileName) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error(`Marketplace asset is not a PNG: ${fileName}`);
  }
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`Marketplace PNG has no valid IHDR: ${fileName}`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
