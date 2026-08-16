import { createHash } from "node:crypto";
import spdxExceptionData from "../release/spdx-exceptions.json" with { type: "json" };

export const RELEASE_POLICY_VERSION = 1;

// These are the licenses accepted by the desktop extension's release policy. An SPDX
// expression containing an OR is accepted when at least one complete alternative is
// in this set; every term in an AND alternative must be accepted.
export const ALLOWED_LICENSE_IDS = Object.freeze([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
]);

// This list is generated from the pinned SPDX License List data file under
// release/spdx-exceptions.json. The product policy intentionally permits only
// the reviewed exceptions below; canonical does not mean compatible here.
export const ALLOWED_SPDX_EXCEPTION_IDS = Object.freeze(spdxExceptionData.licenseExceptionIds);
export const POLICY_COMPATIBLE_SPDX_EXCEPTION_IDS = Object.freeze([
  "GStreamer-exception-2008",
  "LLVM-exception",
]);

const allowedLicenses = new Set(ALLOWED_LICENSE_IDS);
const canonicalSpdxExceptions = new Set(ALLOWED_SPDX_EXCEPTION_IDS);
const allowedSpdxExceptions = new Set(POLICY_COMPATIBLE_SPDX_EXCEPTION_IDS);
if (
  spdxExceptionData.schemaVersion !== 1 ||
  spdxExceptionData.source !==
    "https://raw.githubusercontent.com/spdx/license-list-data/779ef2e5dff6d4af389c53de5e97116ab0bb52e8/json/exceptions.json" ||
  spdxExceptionData.sourceVersion !== "3.28.0" ||
  !Array.isArray(spdxExceptionData.licenseExceptionIds) ||
  canonicalSpdxExceptions.size !== ALLOWED_SPDX_EXCEPTION_IDS.length ||
  ALLOWED_SPDX_EXCEPTION_IDS.some(
    (identifier) => typeof identifier !== "string" || !/^[A-Za-z0-9.-]+$/u.test(identifier),
  ) ||
  POLICY_COMPATIBLE_SPDX_EXCEPTION_IDS.some(
    (identifier) => !canonicalSpdxExceptions.has(identifier),
  )
) {
  throw new Error("Pinned SPDX exception data is invalid or out of policy.");
}
const forbiddenVsixFragments = Object.freeze([
  "/node_modules/",
  "/.pnpm/",
  "/.vscode-test/",
  "/coverage/",
  "/.cache/",
  "/.git/",
  "/.github/",
  "/test/",
  "/tests/",
  "/fixtures/",
  "/snapshots/",
]);
const forbiddenVsixSuffixes = Object.freeze([".map", ".lock", ".log", ".env", ".pem", ".key"]);
const executableSuffixes = Object.freeze([
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".dylib",
  ".exe",
  ".ps1",
  ".sh",
  ".so",
  ".node",
  ".wasm",
]);

export function normalizeLicenseExpression(value) {
  if (typeof value === "string") {
    return value.trim().replace(/\s+/gu, " ");
  }
  if (value && typeof value === "object") {
    if (typeof value.type === "string") {
      return value.type.trim().replace(/\s+/gu, " ");
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => normalizeLicenseExpression(entry))
        .filter(Boolean)
        .join(" OR ");
    }
  }
  return "";
}

export function isCompatibleLicenseExpression(value) {
  const expression = normalizeLicenseExpression(value);
  if (expression === "") {
    return false;
  }

  const tokens = expression.match(/[A-Za-z0-9.+-]+|[()]/gu);
  if (!tokens || tokens.join("") !== expression.replace(/\s+/gu, "")) {
    return false;
  }

  let index = 0;
  let unknownException = false;

  function parseOr() {
    let compatible = parseAnd();
    while (tokens[index] === "OR") {
      index += 1;
      compatible = parseAnd() || compatible;
    }
    return compatible;
  }

  function parseAnd() {
    let compatible = parseAtom();
    while (tokens[index] === "AND") {
      index += 1;
      compatible = parseAtom() && compatible;
    }
    return compatible;
  }

  function parseAtom() {
    if (tokens[index] === "(") {
      index += 1;
      const compatible = parseOr();
      if (tokens[index] !== ")") {
        throw new Error("Unbalanced SPDX license expression.");
      }
      index += 1;
      return compatible;
    }

    const license = tokens[index];
    if (
      !license ||
      license === ")" ||
      license === "AND" ||
      license === "OR" ||
      license === "WITH"
    ) {
      throw new Error("Malformed SPDX license expression.");
    }
    index += 1;
    let compatible = allowedLicenses.has(license);
    if (tokens[index] === "WITH") {
      index += 1;
      const exception = tokens[index];
      if (
        !exception ||
        exception === ")" ||
        exception === "AND" ||
        exception === "OR" ||
        exception === "WITH"
      ) {
        throw new Error("Malformed SPDX license exception expression.");
      }
      index += 1;
      if (!allowedSpdxExceptions.has(exception)) {
        unknownException = true;
      }
      compatible = compatible && allowedSpdxExceptions.has(exception);
    }
    return compatible;
  }

  try {
    const compatible = parseOr();
    return index === tokens.length && !unknownException && compatible;
  } catch {
    return false;
  }
}

export function validateCompatibleLicenses(packages) {
  if (!Array.isArray(packages)) {
    throw new Error("Third-party license inventory must be an array.");
  }

  for (const dependency of packages) {
    const license = normalizeLicenseExpression(dependency?.license);
    if (
      !dependency ||
      typeof dependency.name !== "string" ||
      typeof dependency.version !== "string"
    ) {
      throw new Error("Third-party license inventory contains an invalid package entry.");
    }
    if (!isCompatibleLicenseExpression(license)) {
      throw new Error(
        `Incompatible license for ${dependency.name}@${dependency.version}: ${license || "missing"}.`,
      );
    }
  }
}

export function canonicalizeDependencyInventory(packages) {
  if (!Array.isArray(packages)) {
    throw new Error("Dependency inventory must be an array.");
  }
  return packages
    .map((dependency) => ({
      name: dependency?.name,
      version: dependency?.version,
      license: normalizeLicenseExpression(dependency?.license),
    }))
    .sort((left, right) =>
      `${left.name}\u0000${left.version}\u0000${left.license}`.localeCompare(
        `${right.name}\u0000${right.version}\u0000${right.license}`,
        "en",
      ),
    );
}

export function assertDependencyInventoryMatches(actual, expected) {
  const actualCanonical = canonicalizeDependencyInventory(actual);
  const expectedCanonical = canonicalizeDependencyInventory(expected);
  if (JSON.stringify(actualCanonical) !== JSON.stringify(expectedCanonical)) {
    throw new Error("Third-party license/SBOM inventory differs from the declared inventory.");
  }
}

export function validateSpdxDocument(document, packages) {
  if (
    document?.spdxVersion !== "SPDX-2.3" ||
    document.dataLicense !== "CC0-1.0" ||
    document.SPDXID !== "SPDXRef-DOCUMENT" ||
    !Array.isArray(document.packages)
  ) {
    throw new Error("Release SBOM must be a deterministic SPDX-2.3 document.");
  }

  const declared = canonicalizeDependencyInventory(packages);
  const sbomPackages = document.packages.map((entry) => ({
    name: entry?.name,
    version: entry?.versionInfo,
    license: entry?.licenseDeclared,
  }));
  assertDependencyInventoryMatches(sbomPackages, declared);
}

export function createSpdxDocument({ name, version, packages }) {
  const inventory = canonicalizeDependencyInventory(packages);
  validateCompatibleLicenses(inventory);
  const packageEntries = inventory.map((dependency) => {
    const packageId = `SPDXRef-${hash(`${dependency.name}@${dependency.version}`).slice(0, 16)}`;
    return {
      SPDXID: packageId,
      name: dependency.name,
      versionInfo: dependency.version,
      downloadLocation: dependency.resolved ?? "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: dependency.license,
      licenseDeclared: dependency.license,
      ...(dependency.name.startsWith("@")
        ? {
            externalRefs: [
              {
                referenceCategory: "PACKAGE-MANAGER",
                referenceType: "purl",
                referenceLocator:
                  `pkg:npm/${dependency.name.replace("/", "/")}` + `@${dependency.version}`,
              },
            ],
          }
        : {
            externalRefs: [
              {
                referenceCategory: "PACKAGE-MANAGER",
                referenceType: "purl",
                referenceLocator: `pkg:npm/${dependency.name}@${dependency.version}`,
              },
            ],
          }),
    };
  });

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${name}-${version}`,
    documentNamespace: `https://github.com/yangzuo0621/ctrl-zebra/sbom/${name}/${version}`,
    creationInfo: {
      created: "1970-01-01T00:00:00Z",
      creators: ["Tool: ctrl-zebra-release-audit"],
    },
    packages: packageEntries,
    relationships: packageEntries.map((entry) => ({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: entry.SPDXID,
    })),
  };
}

export function validateChangelogEntry(changelog, version) {
  if (typeof changelog !== "string") {
    throw new Error("CHANGELOG.md is missing or unreadable.");
  }
  const heading = `## [${version}]`;
  const headingIndex = changelog.indexOf(heading);
  if (headingIndex < 0) {
    throw new Error(`CHANGELOG.md is missing the ${heading} release notes.`);
  }
  const rest = changelog.slice(headingIndex + heading.length);
  const nextHeading = rest.search(/^##\s+/mu);
  const section = (nextHeading < 0 ? rest : rest.slice(0, nextHeading))
    .replace(/^\s*$/gmu, "")
    .trim();
  if (!section || !/^###\s+/mu.test(section) || !/^-\s+\S/mu.test(section)) {
    throw new Error(`CHANGELOG.md has no release notes for ${version}.`);
  }
}

export function validateUnreleasedChangelog(changelog) {
  validateChangelogEntry(changelog, "Unreleased");
}

export function validateReleaseChecklist(checklist) {
  if (
    typeof checklist !== "string" ||
    !checklist.includes("## Stage 22 reproducible release addendum (T2206)")
  ) {
    throw new Error("Release checklist is missing the T2206 reproducible-release addendum.");
  }
  for (const requiredText of ["version", "CHANGELOG", "SBOM", "protected environment", "VSIX"]) {
    if (!checklist.toLowerCase().includes(requiredText.toLowerCase())) {
      throw new Error(`Release checklist is missing the T2206 ${requiredText} gate.`);
    }
  }
}

export function validateLockfileConsistency({ lockfile, importer = "apps/extension", manifest }) {
  if (typeof lockfile !== "string" || !lockfile.includes("lockfileVersion: '9.0'")) {
    throw new Error("pnpm-lock.yaml is missing the pinned lockfile version.");
  }
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Extension manifest is required for lockfile validation.");
  }

  const importerSection = extractYamlSection(lockfile, `  ${importer}:`);
  const expected = {
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
  };
  for (const [kind, dependencies] of Object.entries(expected)) {
    for (const [name, specifier] of Object.entries(dependencies)) {
      const escapedName = escapeRegExp(name);
      const match = importerSection.match(
        new RegExp(
          `^\\s{6}(?:'${escapedName}'|"${escapedName}"|${escapedName}):\\s*$[\\r\\n]+^\\s{8}specifier:\\s*(.+)$`,
          "mu",
        ),
      );
      if (!match || unquoteYamlScalar(match[1]) !== String(specifier)) {
        throw new Error(`pnpm-lock.yaml ${importer} ${kind} entry is out of sync for ${name}.`);
      }
    }
  }
}

export function validateVersionConsistency({
  version,
  extensionVersion,
  tag,
  changelog,
  lockfile,
  extensionManifest,
  releaseChecklist,
  requireReleaseNotes = Boolean(tag),
}) {
  const expectedVersion = version ?? extensionVersion;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(String(expectedVersion ?? ""))) {
    throw new Error("Extension version must be a valid semver-like release version.");
  }
  if (extensionVersion && String(extensionVersion) !== String(expectedVersion)) {
    throw new Error("Extension manifest version does not match the release version.");
  }
  if (tag && tag !== `v${expectedVersion}`) {
    throw new Error("Release tag must exactly match the extension version.");
  }
  validateLockfileConsistency({ lockfile, manifest: extensionManifest });
  if (requireReleaseNotes) {
    validateChangelogEntry(changelog, expectedVersion);
  } else {
    validateUnreleasedChangelog(changelog);
  }
  validateReleaseChecklist(releaseChecklist);
}

export function validateBuildProvenance(metadata, expected) {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("VSIX build provenance is missing.");
  }
  for (const field of [
    "commit",
    "version",
    "lockfileSha256",
    "changelogSha256",
    "sourceRef",
    "sourceRefType",
  ]) {
    if (metadata[field] !== expected[field]) {
      throw new Error(`VSIX build provenance does not match ${field}.`);
    }
  }
  validateSourceRef({
    sourceRef: metadata.sourceRef,
    sourceRefType: metadata.sourceRefType,
    version: expected.version,
  });
}

export function resolveBuildSource({ environment, version, branch, tag } = {}) {
  if (environment?.GITHUB_ACTIONS === "true") {
    const source = {
      sourceRef: environment.GITHUB_REF,
      sourceRefType: environment.GITHUB_REF_TYPE,
    };
    validateSourceRef({ ...source, version });
    return source;
  }

  if (typeof branch === "string" && branch.trim() !== "") {
    const source = { sourceRef: `refs/heads/${branch}`, sourceRefType: "branch" };
    validateSourceRef({ ...source, version });
    return source;
  }

  if (typeof tag === "string" && tag.trim() !== "") {
    const source = { sourceRef: `refs/tags/${tag}`, sourceRefType: "tag" };
    validateSourceRef({ ...source, version });
    return source;
  }

  throw new Error("Build provenance requires a validated local branch or matching tag.");
}

export function validateReleaseSource(environment, { version, branch = "main" } = {}) {
  if (environment?.GITHUB_ACTIONS !== "true") {
    return false;
  }
  const eventName = environment.GITHUB_EVENT_NAME;
  const ref = environment.GITHUB_REF;
  const refType = environment.GITHUB_REF_TYPE;
  const releaseTag = `v${version}`;
  if (eventName === "push") {
    if (refType !== "tag" || ref !== `refs/tags/${releaseTag}`) {
      throw new Error("Release source tag must exactly match the extension version.");
    }
    return true;
  }
  if (eventName === "workflow_dispatch") {
    if (refType === "branch" && ref === `refs/heads/${branch}`) {
      return true;
    }
    if (refType === "tag" && ref === `refs/tags/${releaseTag}`) {
      return true;
    }
    throw new Error(
      "Release workflow must run from the protected main branch or matching version tag.",
    );
  }
  throw new Error("Release workflow is not allowed for this GitHub Actions event.");
}

export function validateTagAvailability(tag, existingTags, { allowExisting = false } = {}) {
  if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
    throw new Error("Release tag must use the v<semver> format.");
  }
  if (!allowExisting && Array.isArray(existingTags) && existingTags.includes(tag)) {
    throw new Error(`Release tag already exists: ${tag}.`);
  }
}

export function validateDependencyInventoryFile(document, { version, sourceCommit } = {}) {
  if (!document || typeof document !== "object") {
    throw new Error("Third-party dependency inventory metadata is missing.");
  }
  if (document.schemaVersion !== RELEASE_POLICY_VERSION) {
    throw new Error("Third-party dependency inventory schema version is unsupported.");
  }
  if (document.product !== "ctrl-zebra") {
    throw new Error("Third-party dependency inventory product is invalid.");
  }
  if (typeof document.version !== "string" || (version && document.version !== version)) {
    throw new Error("Third-party dependency inventory version does not match the release.");
  }
  if (!/^[0-9a-f]{40}$/u.test(document.sourceCommit ?? "")) {
    throw new Error("Third-party dependency inventory sourceCommit is invalid.");
  }
  if (sourceCommit && document.sourceCommit !== sourceCommit) {
    throw new Error("Third-party dependency inventory sourceCommit does not match the checkout.");
  }
  validateCompatibleLicenses(document.packages);
}

export function validatePublishPreconditions({
  publish = false,
  environment,
  token,
  cancelled = false,
}) {
  if (cancelled) {
    throw new Error("Release publishing was cancelled before credentials were read.");
  }
  if (!publish) {
    return false;
  }
  if (environment !== "release") {
    throw new Error("Marketplace publishing requires the protected release environment.");
  }
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("Marketplace publishing requires a CI secret-store credential.");
  }
  return true;
}

export function validateVsixDependencyAudit({
  archiveEntries,
  extensionManifest,
  declaredDependencies = [],
  allowedExecutableFiles = ["extension/dist/extension.cjs", "extension/dist/webview/main.js"],
}) {
  if (!Array.isArray(archiveEntries)) {
    throw new Error("VSIX dependency audit requires archive entries.");
  }
  const names = archiveEntries.map((entry) =>
    typeof entry === "string" ? entry : entry?.fileName,
  );
  for (const name of names) {
    if (typeof name !== "string" || name === "") {
      throw new Error("VSIX dependency audit encountered an invalid archive entry.");
    }
    const normalized = `/${name.toLowerCase()}`;
    if (
      forbiddenVsixFragments.some((fragment) => normalized.includes(fragment)) ||
      forbiddenVsixSuffixes.some((suffix) => normalized.endsWith(suffix))
    ) {
      throw new Error(`VSIX contains a development cache or forbidden file: ${name}.`);
    }
    const suffix = executableSuffixes.find((candidate) => normalized.endsWith(candidate));
    if ((suffix || normalized.includes("/bin/")) && !allowedExecutableFiles.includes(name)) {
      throw new Error(`VSIX contains an undeclared executable: ${name}.`);
    }
  }

  if (extensionManifest && typeof extensionManifest === "object") {
    const expected = new Set(declaredDependencies);
    const actual = Object.keys(extensionManifest.dependencies ?? {});
    const undeclared = actual.filter((dependency) => !expected.has(dependency));
    if (undeclared.length > 0) {
      throw new Error(`VSIX declares undeclared runtime dependencies: ${undeclared.join(", ")}.`);
    }
  }
}

export function createDependencyInventoryFile({ commit, version, packages }) {
  const inventory = canonicalizeDependencyInventory(packages);
  validateCompatibleLicenses(inventory);
  return {
    schemaVersion: RELEASE_POLICY_VERSION,
    product: "ctrl-zebra",
    version,
    sourceCommit: commit,
    packages: inventory,
  };
}

function validateSourceRef({ sourceRef, sourceRefType, version }) {
  if (sourceRefType === "branch") {
    if (!isSafeGitRef(sourceRef, "refs/heads/")) {
      throw new Error("Build provenance branch ref is invalid.");
    }
    return;
  }
  if (sourceRefType === "tag") {
    if (sourceRef !== `refs/tags/v${version}`) {
      throw new Error("Build provenance tag ref must exactly match the extension version.");
    }
    return;
  }
  throw new Error("Build provenance source ref type is invalid.");
}

function isSafeGitRef(value, prefix) {
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    value.length > prefix.length &&
    !/[\s~^:?*[\\\]]/u.test(value) &&
    !value.includes("..") &&
    !value.endsWith("/") &&
    !value.endsWith(".")
  );
}

function extractYamlSection(text, heading) {
  const start = text.indexOf(`${heading}\n`);
  if (start < 0) {
    throw new Error(`pnpm-lock.yaml is missing importer ${heading.trim()}.`);
  }
  const bodyStart = start + heading.length + 1;
  const nextTopLevel = text.slice(bodyStart).search(/^\S/mu);
  return nextTopLevel < 0 ? text.slice(bodyStart) : text.slice(bodyStart, bodyStart + nextTopLevel);
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
