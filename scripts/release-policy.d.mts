export const RELEASE_POLICY_VERSION: number;
export const ALLOWED_LICENSE_IDS: readonly string[];
export const ALLOWED_SPDX_EXCEPTION_IDS: readonly string[];

export function normalizeLicenseExpression(value: unknown): string;
export function isCompatibleLicenseExpression(value: unknown): boolean;
export function validateCompatibleLicenses(packages: readonly unknown[]): void;
export function canonicalizeDependencyInventory(packages: readonly unknown[]): readonly unknown[];
export function assertDependencyInventoryMatches(
  actual: readonly unknown[],
  expected: readonly unknown[],
): void;
export function validateSpdxDocument(document: unknown, packages: readonly unknown[]): void;
export function createSpdxDocument(input: {
  name: string;
  version: string;
  packages: readonly unknown[];
}): unknown;
export function validateChangelogEntry(changelog: string, version: string): void;
export function validateUnreleasedChangelog(changelog: string): void;
export function validateReleaseChecklist(checklist: string): void;
export function validateLockfileConsistency(input: {
  lockfile: string;
  importer?: string;
  manifest: Record<string, unknown>;
}): void;
export function validateVersionConsistency(input: {
  version?: string;
  extensionVersion?: string;
  tag?: string;
  changelog: string;
  lockfile: string;
  extensionManifest: Record<string, unknown>;
  releaseChecklist: string;
  requireReleaseNotes?: boolean;
}): void;
export function validateBuildProvenance(metadata: unknown, expected: Record<string, string>): void;
export function resolveBuildSource(input: {
  environment?: Record<string, string | undefined>;
  version: string;
  branch?: string;
  tag?: string;
}): { sourceRef: string; sourceRefType: "branch" | "tag" };
export function validateReleaseSource(
  environment: Record<string, string | undefined>,
  input?: { version?: string; branch?: string },
): boolean;
export function validateTagAvailability(
  tag: string,
  existingTags: readonly string[],
  options?: { allowExisting?: boolean },
): void;
export function validatePublishPreconditions(input: {
  publish?: boolean;
  environment?: string;
  token?: string;
  cancelled?: boolean;
}): boolean;
export function validateVsixDependencyAudit(input: {
  archiveEntries: readonly unknown[];
  extensionManifest?: Record<string, unknown>;
  declaredDependencies?: readonly string[];
  allowedExecutableFiles?: readonly string[];
}): void;
export function createDependencyInventoryFile(input: {
  commit: string;
  version: string;
  packages: readonly unknown[];
}): unknown;
export function validateDependencyInventoryFile(
  document: unknown,
  input?: { version?: string; sourceCommit?: string },
): void;
