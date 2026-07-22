export const MAX_VSIX_BYTES = 5 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

export const expectedSelectedFiles = Object.freeze([
  "LICENSE",
  "README.md",
  "dist/extension.cjs",
  "dist/package/build-metadata.json",
  "dist/webview/index.html",
  "dist/webview/main.css",
  "dist/webview/main.js",
  "media/ctrl-zebra.svg",
  "package.json",
]);

export const expectedArchiveFiles = Object.freeze([
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/LICENSE.txt",
  "extension/dist/extension.cjs",
  "extension/dist/package/build-metadata.json",
  "extension/dist/webview/index.html",
  "extension/dist/webview/main.css",
  "extension/dist/webview/main.js",
  "extension/media/ctrl-zebra.svg",
  "extension/package.json",
  "extension/readme.md",
]);

export function assertCleanStatus(status) {
  if (status.trim() !== "") {
    throw new Error("Official VSIX packaging requires a clean Git worktree.");
  }
}

export function validateSelectedFiles(files) {
  assertExactFileSet(files, expectedSelectedFiles, "vsce file selection");
}

export function validateArchiveEntries(entries, compressedBytes) {
  if (!Number.isSafeInteger(compressedBytes) || compressedBytes < 0) {
    throw new Error("VSIX compressed size is invalid.");
  }
  if (compressedBytes > MAX_VSIX_BYTES) {
    throw new Error(`VSIX exceeds the ${MAX_VSIX_BYTES}-byte compressed limit.`);
  }

  const names = [];
  let uncompressedBytes = 0;
  for (const entry of entries) {
    validateArchivePath(entry.fileName);
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      throw new Error(`VSIX entry has an invalid size: ${entry.fileName}`);
    }
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error(`VSIX entry exceeds the ${MAX_ENTRY_BYTES}-byte limit: ${entry.fileName}`);
    }
    uncompressedBytes += entry.uncompressedSize;
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`VSIX exceeds the ${MAX_UNCOMPRESSED_BYTES}-byte uncompressed limit.`);
    }
    names.push(entry.fileName);
  }

  assertExactFileSet(names, expectedArchiveFiles, "VSIX archive");
  return { compressedBytes, uncompressedBytes, files: [...names].sort() };
}

export function validateBuildMetadata(metadata, expected) {
  if (
    !isRecord(metadata) ||
    metadata.commit !== expected.commit ||
    metadata.version !== expected.version
  ) {
    throw new Error("VSIX build metadata does not match the packaged source commit and version.");
  }
}

export function validateReleaseDocuments(documents) {
  if (documents.rootReadme.length === 0 || documents.rootReadme !== documents.extensionReadme) {
    throw new Error("The repository and packaged README files must be identical and non-empty.");
  }
  if (documents.rootLicense.length === 0 || documents.rootLicense !== documents.extensionLicense) {
    throw new Error("The repository and packaged LICENSE files must be identical and non-empty.");
  }
}

function assertExactFileSet(actualFiles, expectedFiles, label) {
  const normalized = actualFiles.map((file) => {
    validateArchivePath(file);
    return file;
  });
  const exact = new Set(normalized);
  const folded = new Set(normalized.map((file) => file.toLowerCase()));
  if (exact.size !== normalized.length || folded.size !== normalized.length) {
    throw new Error(`${label} contains duplicate or case-colliding paths.`);
  }

  const actual = [...normalized].sort();
  const expected = [...expectedFiles].sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    const unexpected = actual.filter((file) => !expected.includes(file));
    const missing = expected.filter((file) => !actual.includes(file));
    throw new Error(
      `${label} differs from the allowlist; unexpected=${JSON.stringify(unexpected)}, missing=${JSON.stringify(missing)}.`,
    );
  }
}

function validateArchivePath(fileName) {
  if (
    fileName === "" ||
    fileName.includes("\\") ||
    fileName.startsWith("/") ||
    /^[A-Za-z]:/.test(fileName) ||
    fileName.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`VSIX contains an unsafe path: ${fileName}`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
