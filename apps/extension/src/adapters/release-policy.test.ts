import { describe, expect, it } from "vitest";

import {
  ALLOWED_SPDX_EXCEPTION_IDS,
  assertDependencyInventoryMatches,
  createDependencyInventoryFile,
  createSpdxDocument,
  isCompatibleLicenseExpression,
  resolveBuildSource,
  SPDX_EXCEPTION_CATALOG_SHA256,
  SPDX_EXCEPTION_SOURCE,
  SPDX_EXCEPTION_SOURCE_SHA256,
  SPDX_EXCEPTION_SOURCE_VERSION,
  validateBuildProvenance,
  validateCompatibleLicenses,
  validateDependencyInventoryFile,
  validatePublishPreconditions,
  validateReleaseDocument,
  validateReleaseSource,
  validateSpdxDocument,
  validateSpdxExceptionCatalog,
  validateTagAvailability,
  validateVersionConsistency,
  validateVsixDependencyAudit,
} from "../../../../scripts/release-policy.mjs";

const manifest = {
  dependencies: { runtime: "1.2.3" },
  devDependencies: { test: "4.5.6" },
};

const lockfile = `lockfileVersion: '9.0'

importers:

  apps/extension:
    dependencies:
      runtime:
        specifier: 1.2.3
        version: 1.2.3
    devDependencies:
      test:
        specifier: 4.5.6
        version: 4.5.6
`;

const changelog = `# Changelog

## [Unreleased]

### Added

- A pending change.

## [1.2.3]

### Fixed

- A release note.
`;

const releaseDocument = `# Release

## Preconditions
## Quality gates
## Version and changelog
## Reproducible packaging
## VSIX contents
## SBOM and license audit
## Smoke testing
## Marketplace candidate validation
## Protected publication
## Explicit authorization boundary

version CHANGELOG.md SBOM protected environment VSIX Marketplace
`;

describe("release policy", () => {
  it("rejects candidate-specific evidence in the current release document", () => {
    for (const evidence of [
      "source commit: 0123456789abcdef0123456789abcdef01234567",
      "artifact ctrl-zebra-0.1.1-abcdef12.vsix",
      "verified on 2026-07-22",
      "workflow run 32373404894",
      "PR 270 candidate evidence",
      "Stage 22 addendum",
    ]) {
      expect(() => validateReleaseDocument(`${releaseDocument}\n${evidence}`)).toThrow(
        /candidate-specific historical evidence/,
      );
    }
  });

  it("accepts a normal version, lockfile, release note, and release document", () => {
    expect(() =>
      validateVersionConsistency({
        version: "1.2.3",
        extensionVersion: "1.2.3",
        tag: "v1.2.3",
        changelog,
        lockfile,
        extensionManifest: manifest,
        releaseDocument,
        requireReleaseNotes: true,
      }),
    ).not.toThrow();
  });

  it("rejects version mismatches and missing release notes", () => {
    expect(() =>
      validateVersionConsistency({
        version: "1.2.4",
        extensionVersion: "1.2.3",
        changelog,
        lockfile,
        extensionManifest: manifest,
        releaseDocument,
      }),
    ).toThrow(/manifest version/);

    expect(() =>
      validateVersionConsistency({
        version: "1.2.3",
        extensionVersion: "1.2.3",
        tag: "v1.2.3",
        changelog: changelog.replace("### Fixed\n\n- A release note.\n", ""),
        lockfile,
        extensionManifest: manifest,
        releaseDocument,
        requireReleaseNotes: true,
      }),
    ).toThrow(/no release notes/);
  });

  it("rejects incompatible licenses and inventory/SBOM differences", () => {
    expect(() =>
      validateCompatibleLicenses([{ name: "bad", version: "1.0.0", license: "GPL-3.0-only" }]),
    ).toThrow(/Incompatible license/);

    const inventory = [{ name: "runtime", version: "1.2.3", license: "MIT" }];
    const sbom = createSpdxDocument({ name: "ctrl-zebra", version: "1.2.3", packages: inventory });
    expect(() => validateSpdxDocument(sbom, inventory)).not.toThrow();
    expect(() =>
      assertDependencyInventoryMatches(inventory, [
        { name: "runtime", version: "1.2.4", license: "MIT" },
      ]),
    ).toThrow(/differs/);
    expect(isCompatibleLicenseExpression("MIT WITH UnknownException")).toBe(false);
    expect(isCompatibleLicenseExpression("MIT WITH GPL-3.0-with-GCC-exception")).toBe(false);
    expect(ALLOWED_SPDX_EXCEPTION_IDS).toContain("GStreamer-exception-2008");
    expect(ALLOWED_SPDX_EXCEPTION_IDS).not.toContain("GPL-3.0-with-GCC-exception");
    expect(isCompatibleLicenseExpression("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isCompatibleLicenseExpression("Apache-2.0 WITH GStreamer-exception-2008")).toBe(true);
    expect(isCompatibleLicenseExpression("Apache-2.0 WITH GCC-exception-3.1")).toBe(false);
    expect(() =>
      validateCompatibleLicenses([
        { name: "bad-exception", version: "1.0.0", license: "MIT WITH UnknownException" },
      ]),
    ).toThrow(/Incompatible license/);
  });

  it("parses full SPDX license expression grammar via spdx-expression-parse", () => {
    // A "+" grants "this version or later"; it does not narrow compatibility.
    expect(isCompatibleLicenseExpression("Apache-2.0+")).toBe(true);
    expect(isCompatibleLicenseExpression("GPL-3.0-only+")).toBe(false);
    // Operator keywords are matched case-insensitively per the SPDX expression grammar,
    // while license identifiers themselves remain case-sensitive.
    expect(isCompatibleLicenseExpression("MIT or Apache-2.0")).toBe(true);
    expect(isCompatibleLicenseExpression("mit")).toBe(false);
    expect(isCompatibleLicenseExpression("(MIT AND Apache-2.0) OR GPL-3.0-only")).toBe(true);
    expect(isCompatibleLicenseExpression("MIT AND GPL-3.0-only")).toBe(false);
    // An unknown exception poisons the whole expression, even inside an OR branch whose
    // own compatibility does not end up deciding the outer result.
    expect(isCompatibleLicenseExpression("(MIT WITH UnknownException) OR Apache-2.0")).toBe(false);
    // Still rejected: unknown license identifiers, LicenseRef, and malformed expressions.
    expect(isCompatibleLicenseExpression("NOT-A-REAL-LICENSE")).toBe(false);
    expect(isCompatibleLicenseExpression("LicenseRef-custom")).toBe(false);
    expect(isCompatibleLicenseExpression("MIT AND")).toBe(false);
    expect(isCompatibleLicenseExpression("(MIT OR Apache-2.0")).toBe(false);
    expect(isCompatibleLicenseExpression("")).toBe(false);
  });

  it("preserves distinct versions of a transitive dependency in the SBOM", () => {
    const inventory = [
      { name: "eventsource-parser", version: "3.1.0", license: "MIT" },
      { name: "eventsource-parser", version: "3.1.1", license: "MIT" },
    ];
    const sbom = createSpdxDocument({ name: "ctrl-zebra", version: "1.2.3", packages: inventory });
    const sbomPackages = (sbom as { packages: Array<{ versionInfo: string }> }).packages;

    expect(sbomPackages).toHaveLength(2);
    expect(sbomPackages.map((entry) => entry.versionInfo)).toEqual(["3.1.0", "3.1.1"]);
    expect(() => validateSpdxDocument(sbom, inventory)).not.toThrow();
  });

  it("fails closed for tampered SPDX catalog source, digest, and identifiers", () => {
    const catalog = {
      schemaVersion: 1,
      source: SPDX_EXCEPTION_SOURCE,
      sourceVersion: SPDX_EXCEPTION_SOURCE_VERSION,
      sourceSha256: SPDX_EXCEPTION_SOURCE_SHA256,
      catalogSha256: SPDX_EXCEPTION_CATALOG_SHA256,
      licenseExceptionIds: [...ALLOWED_SPDX_EXCEPTION_IDS],
    };
    expect(validateSpdxExceptionCatalog(catalog)).toBe(true);
    expect(() =>
      validateSpdxExceptionCatalog({ ...catalog, source: `${catalog.source}/tampered` }),
    ).toThrow(/source is invalid/);
    expect(() =>
      validateSpdxExceptionCatalog({ ...catalog, sourceSha256: "0".repeat(64) }),
    ).toThrow(/source digest is invalid/);
    expect(() =>
      validateSpdxExceptionCatalog({
        ...catalog,
        licenseExceptionIds: [...catalog.licenseExceptionIds, "Unknown-exception"],
      }),
    ).toThrow(/catalog digest is invalid/);
  });

  it("rejects unexpected files, development caches, and undeclared executables", () => {
    expect(() =>
      validateVsixDependencyAudit({
        archiveEntries: ["extension/dist/extension.cjs", "extension/.cache/result.json"],
      }),
    ).toThrow(/development cache/);
    expect(() =>
      validateVsixDependencyAudit({
        archiveEntries: ["extension/dist/extension.cjs", "extension/bin/helper.exe"],
      }),
    ).toThrow(/undeclared executable/);
    expect(() =>
      validateVsixDependencyAudit({
        archiveEntries: ["extension/dist/extension.cjs"],
        extensionManifest: { dependencies: { undeclared: "1.0.0" } },
        declaredDependencies: [],
      }),
    ).toThrow(/undeclared runtime dependencies/);
  });

  it("accepts only the protected release source and matching tag", () => {
    expect(
      validateReleaseSource(
        {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_REF: "refs/heads/main",
          GITHUB_REF_TYPE: "branch",
        },
        { version: "1.2.3" },
      ),
    ).toBe(true);
    expect(() =>
      validateReleaseSource(
        {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_REF: "refs/heads/feature/release",
          GITHUB_REF_TYPE: "branch",
        },
        { version: "1.2.3" },
      ),
    ).toThrow(/protected main branch/);
    expect(() =>
      validateReleaseSource(
        {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "push",
          GITHUB_REF: "refs/tags/v1.2.4",
          GITHUB_REF_TYPE: "tag",
        },
        { version: "1.2.3" },
      ),
    ).toThrow(/version/);
  });

  it("resolves and rejects local/CI source refs fail closed", () => {
    expect(
      resolveBuildSource({
        environment: {
          GITHUB_ACTIONS: "true",
          GITHUB_REF: "refs/heads/main",
          GITHUB_REF_TYPE: "branch",
        },
        version: "1.2.3",
      }),
    ).toEqual({ sourceRef: "refs/heads/main", sourceRefType: "branch" });
    expect(resolveBuildSource({ branch: "release/candidate", version: "1.2.3" })).toEqual({
      sourceRef: "refs/heads/release/candidate",
      sourceRefType: "branch",
    });
    expect(() =>
      resolveBuildSource({
        environment: {
          GITHUB_ACTIONS: "true",
          GITHUB_REF: "refs/heads/main",
          GITHUB_REF_TYPE: "tag",
        },
        version: "1.2.3",
      }),
    ).toThrow(/tag ref/);
    expect(() => resolveBuildSource({ tag: "v1.2.4", version: "1.2.3" })).toThrow(/tag ref/);
    expect(() => resolveBuildSource({ version: "1.2.3" })).toThrow(/validated local/);
  });

  it("requires version-specific notes for a detached matching tag", () => {
    expect(resolveBuildSource({ tag: "v1.2.3", version: "1.2.3" })).toEqual({
      sourceRef: "refs/tags/v1.2.3",
      sourceRefType: "tag",
    });
    expect(() =>
      validateVersionConsistency({
        version: "1.2.3",
        extensionVersion: "1.2.3",
        tag: "v1.2.3",
        changelog: changelog.replace("## [1.2.3]", "## [1.2.4]"),
        lockfile,
        extensionManifest: manifest,
        releaseDocument,
        requireReleaseNotes: true,
      }),
    ).toThrow(/release notes/);
  });

  it("fails closed for missing credentials, duplicate tags, and cancellation", () => {
    expect(() =>
      validatePublishPreconditions({ publish: true, environment: "release", token: "" }),
    ).toThrow(/CI secret-store credential/);
    expect(() => validateTagAvailability("v1.2.3", ["v1.2.3"])).toThrow(/already exists/);
    expect(() =>
      validatePublishPreconditions({
        publish: true,
        environment: "release",
        token: "secret-is-never-printed",
        cancelled: true,
      }),
    ).toThrow(/cancelled before credentials/);
    expect(() => validatePublishPreconditions({ cancelled: true })).toThrow(
      /cancelled before credentials/,
    );
    expect(validatePublishPreconditions({ publish: false })).toBe(false);
  });

  it("requires all recorded provenance digests to match", () => {
    const expected = {
      commit: "a".repeat(40),
      version: "1.2.3",
      lockfileSha256: "b".repeat(64),
      changelogSha256: "c".repeat(64),
      sourceRef: "refs/heads/main",
      sourceRefType: "branch",
    };
    expect(() => validateBuildProvenance(expected, expected)).not.toThrow();
    expect(() =>
      validateBuildProvenance({ ...expected, changelogSha256: "d".repeat(64) }, expected),
    ).toThrow(/changelogSha256/);
    expect(() =>
      validateBuildProvenance({ ...expected, sourceRef: "refs/heads/tampered" }, expected),
    ).toThrow(/sourceRef/);
    expect(() => validateBuildProvenance({ ...expected, sourceRefType: "tag" }, expected)).toThrow(
      /sourceRefType/,
    );
  });

  it("requires inventory schema, product, version, and source commit metadata", () => {
    const inventory = createDependencyInventoryFile({
      commit: "a".repeat(40),
      version: "1.2.3",
      packages: [{ name: "runtime", version: "1.2.3", license: "MIT" }],
    }) as Record<string, unknown>;
    expect(() =>
      validateDependencyInventoryFile(inventory, {
        version: "1.2.3",
        sourceCommit: "a".repeat(40),
      }),
    ).not.toThrow();
    expect(() => validateDependencyInventoryFile({ ...inventory, product: "other" })).toThrow(
      /product/,
    );
    expect(() =>
      validateDependencyInventoryFile(
        { ...inventory, sourceCommit: "b".repeat(40) },
        { version: "1.2.3", sourceCommit: "a".repeat(40) },
      ),
    ).toThrow(/sourceCommit/);
  });
});
