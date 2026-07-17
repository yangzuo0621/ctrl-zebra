import type { Uri } from "vscode";

export type WorkspaceScopeErrorCode =
  | "invalid-uri"
  | "outside-workspace"
  | "canonicalization-failed";

export class WorkspaceScopeError extends Error {
  constructor(readonly code: WorkspaceScopeErrorCode) {
    super(errorMessages[code]);
    this.name = "WorkspaceScopeError";
  }
}

export type CanonicalizeWorkspaceUri = (uri: Uri, signal: AbortSignal) => Promise<Uri>;

export interface WorkspaceScopeOptions {
  readonly caseSensitivePaths?: boolean;
}

export class WorkspaceScope {
  readonly #selectedRoot: Uri;
  readonly #canonicalize: CanonicalizeWorkspaceUri;
  readonly #caseSensitivePaths: boolean;

  constructor(
    selectedRoot: Uri,
    canonicalize: CanonicalizeWorkspaceUri,
    options: WorkspaceScopeOptions = {},
  ) {
    assertSafeUri(selectedRoot);
    this.#selectedRoot = selectedRoot;
    this.#canonicalize = canonicalize;
    this.#caseSensitivePaths = options.caseSensitivePaths ?? process.platform !== "win32";
  }

  async validate(target: Uri, signal: AbortSignal): Promise<Uri> {
    signal.throwIfAborted();
    assertSafeUri(target);
    this.#assertContained(this.#selectedRoot, target);

    let canonicalRoot: Uri;
    let canonicalTarget: Uri;
    try {
      canonicalRoot = await this.#canonicalize(this.#selectedRoot, signal);
      signal.throwIfAborted();
      canonicalTarget = await this.#canonicalize(target, signal);
      signal.throwIfAborted();
    } catch {
      signal.throwIfAborted();
      throw new WorkspaceScopeError("canonicalization-failed");
    }

    assertSafeUri(canonicalRoot);
    assertSafeUri(canonicalTarget);
    this.#assertContained(canonicalRoot, canonicalTarget);
    return canonicalTarget;
  }

  #assertContained(root: Uri, target: Uri): void {
    if (
      !sameIdentityPart(root.scheme, target.scheme) ||
      !sameIdentityPart(root.authority, target.authority)
    ) {
      throw new WorkspaceScopeError("outside-workspace");
    }

    const rootSegments = getPathSegments(root.path);
    const targetSegments = getPathSegments(target.path);
    if (targetSegments.length < rootSegments.length) {
      throw new WorkspaceScopeError("outside-workspace");
    }

    for (let index = 0; index < rootSegments.length; index += 1) {
      if (!this.#samePathSegment(rootSegments[index], targetSegments[index])) {
        throw new WorkspaceScopeError("outside-workspace");
      }
    }
  }

  #samePathSegment(left: string | undefined, right: string | undefined): boolean {
    return this.#caseSensitivePaths
      ? left === right
      : left?.toLocaleLowerCase("en-US") === right?.toLocaleLowerCase("en-US");
  }
}

const errorMessages = {
  "invalid-uri": "Workspace target URI is invalid.",
  "outside-workspace": "Workspace target is outside the selected workspace.",
  "canonicalization-failed": "Workspace target could not be safely canonicalized.",
} as const satisfies Readonly<Record<WorkspaceScopeErrorCode, string>>;

function assertSafeUri(uri: Uri): void {
  if (
    uri.scheme.length === 0 ||
    uri.query.length > 0 ||
    uri.fragment.length > 0 ||
    !uri.path.startsWith("/") ||
    uri.path.includes("\\") ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(uri.path) ||
    /%(?:2e|2f|5c)/iu.test(uri.path) ||
    hasAmbiguousEmptySegment(uri.path)
  ) {
    throw new WorkspaceScopeError("invalid-uri");
  }
}

function hasAmbiguousEmptySegment(path: string): boolean {
  const withoutLeadingSlash = path.slice(1);
  return withoutLeadingSlash.length > 0 && withoutLeadingSlash.split("/").slice(0, -1).includes("");
}

function sameIdentityPart(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function getPathSegments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}
