import type { ReadFileBytes, ReadFileRequest, ReadFileWorkspace } from "@ctrl-zebra/builtin-tools";
import type { Uri } from "vscode";

import type { WorkspaceScope } from "./workspace-scope.js";

export type JoinWorkspacePath = (root: Uri, path: string) => Uri;
export type ReadWorkspaceFilePrefix = (
  target: Uri,
  maxBytes: number,
  signal: AbortSignal,
) => Promise<ReadFileBytes>;

export class WorkspaceFileReader implements ReadFileWorkspace {
  readonly #selectedRoot: Uri;
  readonly #scope: Pick<WorkspaceScope, "validate">;
  readonly #joinPath: JoinWorkspacePath;
  readonly #readPrefix: ReadWorkspaceFilePrefix;

  constructor(
    selectedRoot: Uri,
    scope: Pick<WorkspaceScope, "validate">,
    joinPath: JoinWorkspacePath,
    readPrefix: ReadWorkspaceFilePrefix,
  ) {
    this.#selectedRoot = selectedRoot;
    this.#scope = scope;
    this.#joinPath = joinPath;
    this.#readPrefix = readPrefix;
  }

  async readFile(request: ReadFileRequest, signal: AbortSignal): Promise<ReadFileBytes> {
    signal.throwIfAborted();
    const requestedTarget = this.#joinPath(this.#selectedRoot, request.path);
    const canonicalTarget = await this.#scope.validate(requestedTarget, signal);
    signal.throwIfAborted();
    const result = await this.#readPrefix(canonicalTarget, request.maxBytes, signal);
    signal.throwIfAborted();
    return result;
  }
}
