import { randomUUID } from "node:crypto";

import {
  listFilesExcludeGlob,
  maxReadFileContentBytes,
  type ReadFileBytes,
} from "@ctrl-zebra/builtin-tools";
import {
  type ExtensionToWebviewMessage,
  type IdeTruncationReason,
  ideTextContextSchema,
  maxIdeTextBytes,
  maxWorkspaceFileReferences,
  maxWorkspaceFileSearchResults,
  takeIdeTextPrefix,
  type WorkspaceFileReference,
  type WorkspaceFileReferenceClearReason,
  type WorkspaceFileReferenceStaleReason,
  type WorkspaceFileSearchResult,
  workspaceFilePathSchema,
  workspaceFileReferenceSchema,
  workspaceFileSearchQuerySchema,
} from "@ctrl-zebra/protocol";
import type { Uri } from "vscode";
import type { WorkspaceFindFiles } from "../adapters/workspace-file-lister.js";
import { WorkspaceFileLister } from "../adapters/workspace-file-lister.js";
import type {
  JoinWorkspacePath,
  ReadWorkspaceFilePrefix,
} from "../adapters/workspace-file-reader.js";
import { type WorkspaceScope, WorkspaceScopeError } from "../adapters/workspace-scope.js";

export interface WorkspaceFileReferenceMessageChannel {
  postMessage(message: ExtensionToWebviewMessage): void;
}

export interface WorkspaceFileReferenceViewActions {
  search(requestId: string, query: string): void;
  read(requestId: string, path: string): void;
  remove(requestId: string, referenceId: string): void;
  refresh(requestId: string, referenceId: string): void;
  useStale(requestId: string, referenceId: string): void;
  takeReferences(): readonly WorkspaceFileReference[];
  clearInput(): void;
  invalidateLiveState(): void;
  dispose(): void;
}

export interface WorkspaceFileReferenceActionsDependencies {
  readonly getSelectedRoot: () => Uri | undefined;
  readonly createScope: (root: Uri) => Pick<WorkspaceScope, "validate">;
  readonly joinPath: JoinWorkspacePath;
  readonly findFiles: WorkspaceFindFiles;
  readonly readPrefix: ReadWorkspaceFilePrefix;
  readonly getFileFingerprint?: (uri: Uri) => Promise<string>;
  readonly getLanguageId?: (uri: Uri) => string | undefined;
  readonly getDocumentVersion?: (uri: Uri) => number | undefined;
  readonly createId?: () => string;
  readonly onDispose?: () => void;
}

interface ReferenceState {
  readonly requestedUri: Uri;
  readonly canonicalUri: Uri;
  readonly path: string;
  reference: WorkspaceFileReference;
  staleAccepted: boolean;
}

interface ReadResult {
  readonly reference: WorkspaceFileReference;
  readonly stale: boolean;
  readonly reason?: WorkspaceFileReferenceStaleReason;
}

const searchLimit = maxWorkspaceFileSearchResults + 1;

/**
 * Owns Webview-local @ file references while keeping every VS Code URI and file read on the Host.
 * The controller intentionally keeps a bounded snapshot rather than a live document handle.
 */
export class WorkspaceFileReferenceActions implements WorkspaceFileReferenceViewActions {
  readonly #dependencies: WorkspaceFileReferenceActionsDependencies;
  readonly #createId: () => string;
  readonly #states = new Map<string, ReferenceState>();
  readonly #reads = new Set<AbortController>();
  #post: ((message: ExtensionToWebviewMessage) => void) | undefined;
  #disposed = false;

  constructor(dependencies: WorkspaceFileReferenceActionsDependencies) {
    this.#dependencies = dependencies;
    this.#createId = dependencies.createId ?? randomUUID;
  }

  bind(post: (message: ExtensionToWebviewMessage) => void): void {
    this.#post = post;
  }

  search(requestId: string, query: string): void {
    const parsedQuery = workspaceFileSearchQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      this.#postSearchError(requestId, "limit-exceeded");
      return;
    }

    const controller = this.#startRead();
    void this.#search(requestId, parsedQuery.data, controller)
      .catch((error: unknown) => {
        if (isAbort(error, controller.signal)) return;
        this.#postSearchError(requestId, toErrorCode(error));
      })
      .finally(() => this.#reads.delete(controller));
  }

  read(requestId: string, path: string): void {
    const parsedPath = workspaceFilePathSchema.safeParse(path);
    if (!parsedPath.success) {
      this.#postReferenceError(requestId, undefined, "outside-workspace");
      return;
    }

    const controller = this.#startRead();
    void this.#readPath(parsedPath.data, controller.signal)
      .then((result) => {
        if (result.stale) {
          this.#postReference({
            protocolVersion: 1,
            type: "extension/workspace-file-reference",
            requestId,
            status: "stale",
            reference: result.reference,
            reason: result.reason ?? "changed-during-read",
          });
        } else {
          this.#postReference({
            protocolVersion: 1,
            type: "extension/workspace-file-reference",
            requestId,
            status: "ready",
            reference: result.reference,
          });
        }
      })
      .catch((error: unknown) => {
        if (isAbort(error, controller.signal)) return;
        this.#postReferenceError(requestId, undefined, toErrorCode(error));
      })
      .finally(() => this.#reads.delete(controller));
  }

  remove(requestId: string, referenceId: string): void {
    const state = this.#states.get(referenceId);
    if (state === undefined) return;
    this.#states.delete(referenceId);
    this.#postReference({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId,
      status: "removed",
      referenceId,
      reason: "removed",
    });
  }

  refresh(requestId: string, referenceId: string): void {
    const state = this.#states.get(referenceId);
    if (state === undefined) {
      this.#postReferenceError(requestId, referenceId, "unavailable");
      return;
    }

    const controller = this.#startRead();
    void this.#readPath(state.path, controller.signal, referenceId)
      .then((result) => {
        if (result.stale) {
          this.#postReference({
            protocolVersion: 1,
            type: "extension/workspace-file-reference",
            requestId,
            status: "stale",
            reference: result.reference,
            reason: result.reason ?? "changed-during-read",
          });
        } else {
          this.#postReference({
            protocolVersion: 1,
            type: "extension/workspace-file-reference",
            requestId,
            status: "ready",
            reference: result.reference,
          });
        }
      })
      .catch((error: unknown) => {
        if (isAbort(error, controller.signal)) return;
        this.#postReferenceError(requestId, referenceId, toErrorCode(error));
      })
      .finally(() => this.#reads.delete(controller));
  }

  useStale(requestId: string, referenceId: string): void {
    const state = this.#states.get(referenceId);
    if (state === undefined || !state.reference.context.source.stale) return;
    state.staleAccepted = true;
    this.#postReference({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId,
      status: "ready",
      reference: state.reference,
    });
  }

  takeReferences(): readonly WorkspaceFileReference[] {
    const references = [...this.#states.values()]
      .filter((state) => !state.reference.context.source.stale || state.staleAccepted)
      .map((state) => state.reference);
    this.clearInput();
    return references;
  }

  clearInput(): void {
    this.#states.clear();
    this.invalidateLiveState();
  }

  invalidateLiveState(): void {
    for (const controller of this.#reads)
      controller.abort(new Error("Workspace file state changed."));
    this.#reads.clear();
  }

  /** Marks matching snapshots stale after a Host-side document/filesystem event. */
  notifyChanged(uri: Uri, reason: WorkspaceFileReferenceStaleReason): void {
    for (const state of this.#states.values()) {
      if (!sameUri(state.requestedUri, uri) && !sameUri(state.canonicalUri, uri)) continue;
      this.#markStale(state, reason);
    }
  }

  /** Clears references when the selected root or trust boundary changes. */
  clearForBoundaryChange(reason: Exclude<WorkspaceFileReferenceClearReason, "removed">): void {
    const ids = [...this.#states.keys()];
    this.#states.clear();
    this.invalidateLiveState();
    for (const referenceId of ids) {
      this.#postReference({
        protocolVersion: 1,
        type: "extension/workspace-file-reference",
        requestId: this.#createId(),
        status: "removed",
        referenceId,
        reason,
      });
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clearInput();
    this.#post = undefined;
    this.#dependencies.onDispose?.();
  }

  async #search(requestId: string, query: string, controller: AbortController): Promise<void> {
    const root = this.#dependencies.getSelectedRoot();
    if (root === undefined) throw new WorkspaceFileReferenceError("no-workspace");
    const scope = this.#dependencies.createScope(root);
    const lister = new WorkspaceFileLister(root, scope, this.#dependencies.findFiles);
    const paths = await lister.findFiles(
      {
        glob: "**/*",
        excludeGlob: listFilesExcludeGlob,
        maxResults: searchLimit,
      },
      controller.signal,
    );
    controller.signal.throwIfAborted();
    const normalized = query.trim().toLocaleLowerCase("en-US");
    const filtered = paths
      .filter(
        (path) => normalized.length === 0 || path.toLocaleLowerCase("en-US").includes(normalized),
      )
      .sort((left, right) => left.localeCompare(right, "en-US"));
    const results: readonly WorkspaceFileSearchResult[] = filtered
      .slice(0, maxWorkspaceFileSearchResults)
      .map((path) => ({ path }));
    this.#postSearch({
      protocolVersion: 1,
      type: "extension/workspace-file-search",
      requestId,
      status: "ready",
      results: [...results],
      truncated: filtered.length > results.length || paths.length >= searchLimit,
    });
  }

  async #readPath(
    path: string,
    signal: AbortSignal,
    requestedReferenceId?: string,
  ): Promise<ReadResult> {
    if (this.#disposed) throw new WorkspaceFileReferenceError("unavailable");
    const parsedPath = workspaceFilePathSchema.parse(path);
    const root = this.#dependencies.getSelectedRoot();
    if (root === undefined) throw new WorkspaceFileReferenceError("no-workspace");
    const requestedUri = this.#dependencies.joinPath(root, parsedPath);
    const scope = this.#dependencies.createScope(root);
    let canonicalRoot: Uri;
    let canonicalTarget: Uri;
    try {
      canonicalRoot = await scope.validate(root, signal);
      canonicalTarget = await scope.validate(requestedUri, signal);
    } catch (error) {
      signal.throwIfAborted();
      throw toWorkspaceError(error);
    }
    signal.throwIfAborted();

    const identity = canonicalTarget.toString();
    const existing = [...this.#states.entries()].find(
      ([id, state]) =>
        (requestedReferenceId === undefined || id === requestedReferenceId) &&
        state.canonicalUri.toString() === identity,
    );
    if (existing !== undefined && !existing[1].reference.context.source.stale) {
      return { reference: existing[1].reference, stale: false };
    }

    if (existing === undefined && this.#states.size >= maxWorkspaceFileReferences) {
      throw new WorkspaceFileReferenceError("limit-exceeded");
    }

    const fingerprintBefore = await this.#fingerprint(canonicalTarget);
    const bytes = await this.#dependencies.readPrefix(
      canonicalTarget,
      Math.max(maxIdeTextBytes, maxReadFileContentBytes) + 4,
      signal,
    );
    signal.throwIfAborted();
    const decoded = decodeText(bytes);
    if (decoded === undefined) throw new WorkspaceFileReferenceError("binary");
    const fingerprintAfter = await this.#fingerprint(canonicalTarget);
    signal.throwIfAborted();

    const relativePath = toRelativePath(canonicalRoot, canonicalTarget);
    const textProjection = takeIdeTextPrefix(decoded.text);
    const truncationReasons = mergeTruncationReasons(
      decoded.truncated ? ["utf8-bytes"] : [],
      textProjection.truncationReasons,
    );
    const languageId = this.#dependencies.getLanguageId?.(canonicalTarget);
    const documentVersion = this.#dependencies.getDocumentVersion?.(canonicalTarget);
    const authority: "" | "workspace" = canonicalTarget.authority.length === 0 ? "" : "workspace";
    const source = {
      uri: {
        scheme: canonicalTarget.scheme,
        authority,
        path: relativePath,
      },
      ...(languageId === undefined ? {} : { languageId }),
      ...(documentVersion === undefined ? {} : { documentVersion }),
      stale: fingerprintBefore !== fingerprintAfter,
      truncated: decoded.truncated || textProjection.truncated,
      ...(truncationReasons.length === 0 ? {} : { truncationReasons }),
    };
    const context = ideTextContextSchema.parse({ text: textProjection.text, source });
    const referenceId = existing?.[0] ?? requestedReferenceId ?? this.#createId();
    const reference = workspaceFileReferenceSchema.parse({ referenceId, context });
    const state: ReferenceState = {
      requestedUri,
      canonicalUri: canonicalTarget,
      path: relativePath,
      reference,
      staleAccepted: false,
    };
    if (existing !== undefined) this.#states.delete(existing[0]);
    this.#states.set(referenceId, state);
    if (fingerprintBefore !== fingerprintAfter) {
      return { reference, stale: true, reason: "changed-during-read" };
    }
    return { reference, stale: false };
  }

  async #fingerprint(uri: Uri): Promise<string> {
    if (this.#dependencies.getFileFingerprint === undefined) {
      throw new WorkspaceFileReferenceError("unavailable");
    }
    try {
      const fingerprint = await this.#dependencies.getFileFingerprint(uri);
      if (typeof fingerprint !== "string" || fingerprint.length === 0) {
        throw new Error("Invalid workspace file fingerprint.");
      }
      return fingerprint;
    } catch {
      throw new WorkspaceFileReferenceError("unavailable");
    }
  }

  #startRead(): AbortController {
    const controller = new AbortController();
    this.#reads.add(controller);
    return controller;
  }

  #markStale(state: ReferenceState, reason: WorkspaceFileReferenceStaleReason): void {
    if (state.reference.context.source.stale && !state.staleAccepted) return;
    const context = ideTextContextSchema.parse({
      ...state.reference.context,
      source: { ...state.reference.context.source, stale: true },
    });
    state.reference = workspaceFileReferenceSchema.parse({
      referenceId: state.reference.referenceId,
      context,
    });
    state.staleAccepted = false;
    this.#postReference({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId: this.#createId(),
      status: "stale",
      reference: state.reference,
      reason,
    });
  }

  #postSearch(
    message: Extract<ExtensionToWebviewMessage, { type: "extension/workspace-file-search" }>,
  ): void {
    if (!this.#disposed) this.#post?.(message);
  }

  #postSearchError(requestId: string, code: WorkspaceFileReferenceErrorCode): void {
    this.#postSearch({
      protocolVersion: 1,
      type: "extension/workspace-file-search",
      requestId,
      status: "error",
      code,
      message: errorMessage(code),
    });
  }

  #postReference(
    message: Extract<ExtensionToWebviewMessage, { type: "extension/workspace-file-reference" }>,
  ): void {
    if (!this.#disposed) this.#post?.(message);
  }

  #postReferenceError(
    requestId: string,
    referenceId: string | undefined,
    code: WorkspaceFileReferenceErrorCode,
  ): void {
    this.#postReference({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId,
      status: "error",
      ...(referenceId === undefined ? {} : { referenceId }),
      code,
      message: errorMessage(code),
    });
  }
}

export type WorkspaceFileReferenceErrorCode =
  | "untrusted-workspace"
  | "no-workspace"
  | "outside-workspace"
  | "binary"
  | "changed-during-read"
  | "unavailable"
  | "limit-exceeded";

export class WorkspaceFileReferenceError extends Error {
  constructor(readonly code: WorkspaceFileReferenceErrorCode) {
    super(errorMessage(code));
    this.name = "WorkspaceFileReferenceError";
  }
}

function decodeText(
  source: ReadFileBytes,
): { readonly text: string; readonly truncated: boolean } | undefined {
  if (source.bytes.includes(0)) return undefined;
  const candidate = source.bytes.subarray(0, maxIdeTextBytes);
  const truncated = source.truncated || source.bytes.byteLength > maxIdeTextBytes;
  const maxTrim = truncated ? Math.min(3, candidate.byteLength) : 0;
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          candidate.subarray(0, candidate.byteLength - trim),
        ),
        truncated: truncated || trim > 0,
      };
    } catch {
      // A truncated prefix may end in an incomplete UTF-8 scalar; remove only that suffix.
    }
  }
  return undefined;
}

function mergeTruncationReasons(
  left: readonly IdeTruncationReason[],
  right: readonly IdeTruncationReason[],
): readonly IdeTruncationReason[] {
  const reasons = new Set([...left, ...right]);
  return (
    ["code-points", "utf8-bytes", "lines", "entries", "tokens", "out-of-workspace"] as const
  ).filter((reason): reason is IdeTruncationReason => reasons.has(reason));
}

function toRelativePath(root: Uri, target: Uri): string {
  const rootSegments = getPathSegments(root.path);
  const targetSegments = getPathSegments(target.path);
  const relativePath = targetSegments.slice(rootSegments.length).join("/");
  if (relativePath.length === 0) throw new WorkspaceFileReferenceError("outside-workspace");
  return workspaceFilePathSchema.parse(relativePath);
}

function getPathSegments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function sameUri(left: Uri, right: Uri): boolean {
  return (
    left.scheme === right.scheme &&
    left.authority === right.authority &&
    left.path === right.path &&
    left.query === right.query &&
    left.fragment === right.fragment
  );
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

function toWorkspaceError(error: unknown): WorkspaceFileReferenceError {
  if (error instanceof WorkspaceFileReferenceError) return error;
  if (error instanceof WorkspaceScopeError) {
    return new WorkspaceFileReferenceError(
      error.code === "outside-workspace" ? "outside-workspace" : "unavailable",
    );
  }
  return new WorkspaceFileReferenceError("unavailable");
}

function toErrorCode(error: unknown): WorkspaceFileReferenceErrorCode {
  return error instanceof WorkspaceFileReferenceError ? error.code : "unavailable";
}

function errorMessage(code: WorkspaceFileReferenceErrorCode): string {
  return {
    "untrusted-workspace": "Workspace file references are unavailable in the current trust state.",
    "no-workspace": "Open a workspace before selecting a file.",
    "outside-workspace": "The selected file is outside the active workspace.",
    binary: "Only UTF-8 text workspace files can be referenced.",
    "changed-during-read": "The workspace file changed while it was being read.",
    unavailable: "The workspace file is no longer available.",
    "limit-exceeded": "The workspace file reference exceeded a bounded limit.",
  }[code];
}
