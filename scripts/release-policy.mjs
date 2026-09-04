import { createHash } from "node:crypto";
import { valid as validSemver } from "semver";
import parseSpdxExpression from "spdx-expression-parse";

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

export const SPDX_EXCEPTION_SOURCE =
  "https://raw.githubusercontent.com/spdx/license-list-data/c4a7237ec8f4654e867546f9f409749300f1bf4c/json/exceptions.json";
export const SPDX_EXCEPTION_SOURCE_VERSION = "3.28.0";
export const SPDX_EXCEPTION_SOURCE_SHA256 =
  "bd145bb558f44432fcd6f0d7e956ed0124dff72af7641a7cfcb1b557dc390a5b";
export const SPDX_EXCEPTION_CATALOG_SHA256 =
  "2fc95500adc21b07e29d6edc27ed029040ef71f23906d291667c4b0a85c05253";

// This list is generated from the pinned SPDX License List data file under
// release/spdx-exceptions.json. The product policy intentionally permits only
// the reviewed exceptions below; canonical does not mean compatible here.
export const ALLOWED_SPDX_EXCEPTION_IDS = Object.freeze(spdxExceptionData.licenseExceptionIds);
export const POLICY_COMPATIBLE_SPDX_EXCEPTION_IDS = Object.freeze([
  "GStreamer-exception-2008",
  "LLVM-exception",
]);

function serializeSpdxExceptionCatalog(catalog) {
  return JSON.stringify({
    schemaVersion: catalog?.schemaVersion,
    source: catalog?.source,
    sourceVersion: catalog?.sourceVersion,
    licenseExceptionIds: catalog?.licenseExceptionIds,
  });
}

export function validateSpdxExceptionCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Pinned SPDX exception catalog is missing.");
  }
  if (catalog.schemaVersion !== 1) {
    throw new Error("Pinned SPDX exception catalog schema version is unsupported.");
  }
  if (catalog.source !== SPDX_EXCEPTION_SOURCE) {
    throw new Error("Pinned SPDX exception catalog source is invalid.");
  }
  if (catalog.sourceVersion !== SPDX_EXCEPTION_SOURCE_VERSION) {
    throw new Error("Pinned SPDX exception catalog source version is invalid.");
  }
  if (catalog.sourceSha256 !== SPDX_EXCEPTION_SOURCE_SHA256) {
    throw new Error("Pinned SPDX exception source digest is invalid.");
  }
  if (
    !Array.isArray(catalog.licenseExceptionIds) ||
    catalog.licenseExceptionIds.length === 0 ||
    catalog.licenseExceptionIds.some(
      (identifier) => typeof identifier !== "string" || !/^[A-Za-z0-9.-]+$/u.test(identifier),
    ) ||
    new Set(catalog.licenseExceptionIds).size !== catalog.licenseExceptionIds.length
  ) {
    throw new Error("Pinned SPDX exception catalog identifiers are invalid.");
  }
  const catalogSha256 = createHash("sha256")
    .update(serializeSpdxExceptionCatalog(catalog))
    .digest("hex");
  if (
    catalog.catalogSha256 !== SPDX_EXCEPTION_CATALOG_SHA256 ||
    catalog.catalogSha256 !== catalogSha256
  ) {
    throw new Error("Pinned SPDX exception catalog digest is invalid.");
  }
  return true;
}

validateSpdxExceptionCatalog(spdxExceptionData);

const allowedLicenses = new Set(ALLOWED_LICENSE_IDS);
const canonicalSpdxExceptions = new Set(ALLOWED_SPDX_EXCEPTION_IDS);
const allowedSpdxExceptions = new Set(POLICY_COMPATIBLE_SPDX_EXCEPTION_IDS);
if (
  canonicalSpdxExceptions.size !== ALLOWED_SPDX_EXCEPTION_IDS.length ||
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

/**
 * Evaluates one `spdx-expression-parse` AST node against the policy-owned allow lists.
 * Both sides of an AND/OR are always visited (never short-circuited) so an unrecognized
 * exception anywhere in the expression is detected even inside a branch whose own
 * compatibility does not end up deciding the outer result. This mirrors the grammar's own
 * `+` handling: a "later version" qualifier does not narrow compatibility, so it is not
 * consulted here.
 *
 * Reaching this function at all already requires `spdx-expression-parse` to have recognized
 * the exception name as a token, which it only does against its own bundled `spdx-exceptions`
 * package data — a smaller, independently-versioned snapshot than the SPDX List 3.28.0 catalog
 * pinned in `release/spdx-exceptions.json`. An exception id that is canonical in the pinned
 * catalog but absent from the bundled data never reaches `unknownException` here: parsing the
 * whole expression throws first and `isCompatibleLicenseExpression` rejects it via its outer
 * catch. Both paths reject the expression (fail closed, matching this policy's intent), so this
 * is a diagnosability gap, not a soundness one — but it means extending
 * `POLICY_COMPATIBLE_SPDX_EXCEPTION_IDS` with an id the parser dependency doesn't recognize
 * yet would silently reject every dependency using it instead of accepting it.
 */
function evaluateSpdxNode(node) {
  if ("left" in node) {
    const left = evaluateSpdxNode(node.left);
    const right = evaluateSpdxNode(node.right);
    return {
      compatible:
        node.conjunction === "or"
          ? left.compatible || right.compatible
          : left.compatible && right.compatible,
      unknownException: left.unknownException || right.unknownException,
    };
  }

  const compatible = allowedLicenses.has(node.license);
  if (!node.exception) {
    return { compatible, unknownException: false };
  }
  const knownException = allowedSpdxExceptions.has(node.exception);
  return { compatible: compatible && knownException, unknownException: !knownException };
}

export function isCompatibleLicenseExpression(value) {
  const expression = normalizeLicenseExpression(value);
  if (expression === "") {
    return false;
  }

  let node;
  try {
    node = parseSpdxExpression(expression);
  } catch {
    return false;
  }

  const { compatible, unknownException } = evaluateSpdxNode(node);
  return compatible && !unknownException;
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

export function validateReleaseDocument(document) {
  if (typeof document !== "string") {
    throw new Error("docs/release.md is missing or unreadable.");
  }
  for (const requiredHeading of [
    "# Release",
    "## Preconditions",
    "## Quality gates",
    "## Version and changelog",
    "## Reproducible packaging",
    "## VSIX contents",
    "## SBOM and license audit",
    "## Smoke testing",
    "## Marketplace candidate validation",
    "## Protected publication",
    "## Explicit authorization boundary",
  ]) {
    if (!document.includes(requiredHeading)) {
      throw new Error(`Release document is missing ${requiredHeading}.`);
    }
  }
  for (const requiredText of ["CHANGELOG.md", "SBOM", "protected", "VSIX", "Marketplace"]) {
    if (!document.toLowerCase().includes(requiredText.toLowerCase())) {
      throw new Error(`Release document is missing the ${requiredText} gate.`);
    }
  }
  // Concrete commit, artifact, date, and Actions-run shapes are release evidence, not policy.
  // Keep these bounds aligned with the formats emitted by Git and the release workflows.
  for (const forbiddenEvidence of [
    /\b[0-9a-f]{40}\b/iu,
    /\b[\w.-]+-\d+\.\d+\.\d+(?:-[\w.-]+)?\.vsix\b/iu,
    /\b20\d{2}[-/]\d{2}[-/]\d{2}\b/u,
    /(?:workflow\s+run|actions\/runs\/|run\s*#?)\s*\d{6,}/iu,
    /PR\s*270/iu,
    /Stage\s+\d+/iu,
    /candidate source commit/iu,
  ]) {
    if (forbiddenEvidence.test(document)) {
      throw new Error("Release document contains candidate-specific historical evidence.");
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
  releaseDocument,
  requireReleaseNotes = Boolean(tag),
}) {
  const expectedVersion = version ?? extensionVersion;
  const expectedVersionText = String(expectedVersion ?? "");
  // `validSemver` also normalizes (strips a "v" prefix, drops build metadata) instead of
  // rejecting; comparing its output back to the raw text keeps this gate exact-syntax strict —
  // stricter than @vscode/vsce's own bare `semver.valid()` manifest-version check, so anything
  // that passes here is guaranteed to also pass vsce's check later, at packaging time.
  if (validSemver(expectedVersionText, { loose: false }) !== expectedVersionText) {
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
  validateReleaseDocument(releaseDocument);
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
