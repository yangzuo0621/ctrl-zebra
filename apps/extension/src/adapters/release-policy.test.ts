import { describe, expect, it } from "vitest";

import {
  assertDependencyInventoryMatches,
  createDependencyInventoryFile,
  createSpdxDocument,
  isCompatibleLicenseExpression,
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

const releaseChecklist = `## Stage 22 reproducible release addendum (T2206)

version CHANGELOG SBOM protected environment VSIX
`;

describe("T2206 release policy", () => {
  it("accepts a normal version, lockfile, release note, and checklist set", () => {
    expect(() =>
      validateVersionConsistency({
        version: "1.2.3",
        extensionVersion: "1.2.3",
        tag: "v1.2.3",
        changelog,
        lockfile,
        extensionManifest: manifest,
        releaseChecklist,
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
        releaseChecklist,
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
        releaseChecklist,
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
    expect(isCompatibleLicenseExpression("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(() =>
      validateCompatibleLicenses([
        { name: "bad-exception", version: "1.0.0", license: "MIT WITH UnknownException" },
      ]),
    ).toThrow(/Incompatible license/);
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
