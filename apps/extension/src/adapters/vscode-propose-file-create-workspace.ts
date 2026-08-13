import { createHash } from "node:crypto";

import {
  FileCreateTargetExistsError,
  type FileCreateTargetSnapshot,
  type ProposeFileCreateInput,
  type ProposeFileCreateWorkspace,
} from "@ctrl-zebra/builtin-tools";
import { FileType, Uri, workspace } from "vscode";
import { isVscodeFileNotFound } from "./vscode-file-system-error.js";
import type { JoinWorkspacePath } from "./workspace-file-reader.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export class VsCodeProposeFileCreateWorkspace implements ProposeFileCreateWorkspace {
  readonly #root: Uri;
  readonly #scope: Pick<WorkspaceScope, "validateNewFile">;
  readonly #joinPath: JoinWorkspacePath;

  constructor(
    root: Uri,
    scope: Pick<WorkspaceScope, "validateNewFile">,
    joinPath: JoinWorkspacePath,
  ) {
    this.#root = root;
    this.#scope = scope;
    this.#joinPath = joinPath;
  }

  async captureFileCreateTarget(
    request: ProposeFileCreateInput,
    signal: AbortSignal,
  ): Promise<FileCreateTargetSnapshot> {
    signal.throwIfAborted();
    const requested = this.#joinPath(this.#root, request.path);
    const canonical = await this.#scope.validateNewFile(requested, signal);
    signal.throwIfAborted();
    await assertParentDirectory(canonical, signal);
    const current = await statIfPresent(canonical, signal);
    if (current !== undefined) {
      throw new FileCreateTargetExistsError();
    }

    return {
      path: request.path,
      uri: canonical.toString(),
      afterHash: hashText(request.content),
    };
  }

  async isFileCreateTargetAbsent(
    snapshot: FileCreateTargetSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const requested = Uri.parse(snapshot.uri, true);
    const canonical = await this.#scope.validateNewFile(requested, signal);
    signal.throwIfAborted();
    if (canonical.toString() !== snapshot.uri) {
      return false;
    }
    return (await statIfPresent(canonical, signal)) === undefined;
  }
}

async function assertParentDirectory(target: Uri, signal: AbortSignal): Promise<void> {
  const separator = target.path.lastIndexOf("/");
  const parentPath = separator <= 0 ? "/" : target.path.slice(0, separator);
  const parent = target.with({ path: parentPath });
  const stat = await workspace.fs.stat(parent);
  signal.throwIfAborted();
  if ((stat.type & FileType.Directory) === 0) {
    throw new Error("The target file parent is not a directory.");
  }
}

async function statIfPresent(
  target: Uri,
  signal: AbortSignal,
): Promise<{ readonly type: FileType } | undefined> {
  try {
    const stat = await workspace.fs.stat(target);
    signal.throwIfAborted();
    return stat;
  } catch (error) {
    signal.throwIfAborted();
    if (isVscodeFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
