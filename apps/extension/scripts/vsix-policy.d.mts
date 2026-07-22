export interface VsixArchiveEntry {
  readonly fileName: string;
  readonly uncompressedSize: number;
}

export interface VsixBuildMetadata {
  readonly commit: string;
  readonly version: string;
}

export interface VsixInspection {
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly files: string[];
}

export interface ReleaseDocuments {
  readonly rootReadme: string;
  readonly extensionReadme: string;
  readonly rootLicense: string;
  readonly extensionLicense: string;
}

export const MAX_VSIX_BYTES: number;
export const MAX_UNCOMPRESSED_BYTES: number;
export const MAX_ENTRY_BYTES: number;
export const expectedSelectedFiles: readonly string[];
export const expectedArchiveFiles: readonly string[];

export function assertCleanStatus(status: string): void;
export function validateSelectedFiles(files: string[]): void;
export function validateArchiveEntries(
  entries: VsixArchiveEntry[],
  compressedBytes: number,
): VsixInspection;
export function validateBuildMetadata(metadata: unknown, expected: VsixBuildMetadata): void;
export function validateReleaseDocuments(documents: ReleaseDocuments): void;
