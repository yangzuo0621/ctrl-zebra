import { describe, expect, it } from "vitest";

import {
  assertCleanStatus,
  expectedArchiveFiles,
  expectedSelectedFiles,
  MAX_ENTRY_BYTES,
  validateArchiveEntries,
  validateBuildMetadata,
  validateReleaseDocuments,
  validateSelectedFiles,
} from "../../scripts/vsix-policy.mjs";

describe("VSIX package policy", () => {
  it("accepts exactly the selected and archived allowlists", () => {
    expect(() => validateSelectedFiles([...expectedSelectedFiles])).not.toThrow();
    expect(
      validateArchiveEntries(
        expectedArchiveFiles.map((fileName) => ({ fileName, uncompressedSize: 10 })),
        100,
      ),
    ).toEqual({
      compressedBytes: 100,
      uncompressedBytes: expectedArchiveFiles.length * 10,
      files: [...expectedArchiveFiles].sort(),
    });
  });

  it("rejects dirty worktrees, unexpected files, and unsafe archive paths", () => {
    expect(() => assertCleanStatus(" M package.json")).toThrow(/clean Git worktree/);
    expect(() => validateSelectedFiles([...expectedSelectedFiles, "src/extension.ts"])).toThrow(
      /differs from the allowlist/,
    );
    expect(() =>
      validateArchiveEntries(
        expectedArchiveFiles.map((fileName) => ({
          fileName: fileName === "extension/package.json" ? "../package.json" : fileName,
          uncompressedSize: 10,
        })),
        100,
      ),
    ).toThrow(/unsafe path/);
  });

  it("rejects oversized entries and mismatched build metadata", () => {
    expect(() =>
      validateArchiveEntries(
        expectedArchiveFiles.map((fileName, index) => ({
          fileName,
          uncompressedSize: index === 0 ? MAX_ENTRY_BYTES + 1 : 10,
        })),
        100,
      ),
    ).toThrow(/entry exceeds/);
    expect(() =>
      validateBuildMetadata(
        { commit: "other", version: "0.0.0" },
        { commit: "expected", version: "0.0.0" },
      ),
    ).toThrow(/does not match/);
  });

  it("requires identical non-empty repository and packaged release documents", () => {
    expect(() =>
      validateReleaseDocuments({
        rootReadme: "readme\n",
        extensionReadme: "readme\n",
        rootLicense: "license\n",
        extensionLicense: "license\n",
      }),
    ).not.toThrow();
    expect(() =>
      validateReleaseDocuments({
        rootReadme: "current\n",
        extensionReadme: "stale\n",
        rootLicense: "license\n",
        extensionLicense: "license\n",
      }),
    ).toThrow(/README files must be identical/);
    expect(() =>
      validateReleaseDocuments({
        rootReadme: "readme\n",
        extensionReadme: "readme\n",
        rootLicense: "",
        extensionLicense: "",
      }),
    ).toThrow(/LICENSE files must be identical/);
  });
});
