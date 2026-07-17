import type { ListFilesRequest, ListFilesWorkspace } from "@ctrl-zebra/builtin-tools";
import type { Uri } from "vscode";

import type { WorkspaceScope } from "./workspace-scope.js";

export interface WorkspaceFindFilesRequest extends ListFilesRequest {
  readonly baseUri: Uri;
}

export type WorkspaceFindFiles = (
  request: WorkspaceFindFilesRequest,
  signal: AbortSignal,
) => Promise<readonly Uri[]>;

export class WorkspaceFileLister implements ListFilesWorkspace {
  readonly #selectedRoot: Uri;
  readonly #scope: Pick<WorkspaceScope, "validate">;
  readonly #findFiles: WorkspaceFindFiles;

  constructor(
    selectedRoot: Uri,
    scope: Pick<WorkspaceScope, "validate">,
    findFiles: WorkspaceFindFiles,
  ) {
    this.#selectedRoot = selectedRoot;
    this.#scope = scope;
    this.#findFiles = findFiles;
  }

  async findFiles(request: ListFilesRequest, signal: AbortSignal): Promise<readonly string[]> {
    signal.throwIfAborted();
    const targets = await this.#findFiles({ ...request, baseUri: this.#selectedRoot }, signal);
    signal.throwIfAborted();
    const files: string[] = [];

    for (const target of targets) {
      signal.throwIfAborted();
      await this.#scope.validate(target, signal);
      signal.throwIfAborted();
      files.push(toRelativePath(this.#selectedRoot, target));
    }

    return files;
  }
}

function toRelativePath(root: Uri, target: Uri): string {
  const rootSegments = getPathSegments(root.path);
  const targetSegments = getPathSegments(target.path);
  const relativePath = targetSegments.slice(rootSegments.length).join("/");

  if (relativePath.length === 0) {
    throw new Error("Workspace file search returned its root instead of a file.");
  }

  return relativePath;
}

function getPathSegments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}
