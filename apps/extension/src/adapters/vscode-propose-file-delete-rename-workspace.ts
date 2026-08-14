import { createHash } from "node:crypto";

import {
  FileDeleteTargetNotFoundError,
  type FileDeleteTargetSnapshot,
  FileRenameSourceNotFoundError,
  FileRenameTargetExistsError,
  type FileRenameTargetSnapshot,
  type ProposeFileDeleteInput,
  type ProposeFileDeleteWorkspace,
  type ProposeFileRenameInput,
  type ProposeFileRenameWorkspace,
} from "@ctrl-zebra/builtin-tools";
import { FileType, Uri, workspace } from "vscode";

import { isVscodeFileNotFound } from "./vscode-file-system-error.js";
import type { JoinWorkspacePath } from "./workspace-file-reader.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export class VsCodeProposeFileDeleteRenameWorkspace
  implements ProposeFileDeleteWorkspace, ProposeFileRenameWorkspace
{
  readonly #root: Uri;
  readonly #scope: Pick<WorkspaceScope, "validate" | "validateNewFile">;
  readonly #joinPath: JoinWorkspacePath;

  constructor(
    root: Uri,
    scope: Pick<WorkspaceScope, "validate" | "validateNewFile">,
    joinPath: JoinWorkspacePath,
  ) {
    this.#root = root;
    this.#scope = scope;
    this.#joinPath = joinPath;
  }

  readonly hashText = hashText;

  async captureFileDeleteTarget(
    request: ProposeFileDeleteInput,
    signal: AbortSignal,
  ): Promise<FileDeleteTargetSnapshot> {
    signal.throwIfAborted();
    const requested = this.#joinPath(this.#root, request.path);
    const canonical = await this.#scope.validate(requested, signal);
    signal.throwIfAborted();
    const text = await this.#readText(canonical, new FileDeleteTargetNotFoundError(), signal);
    return {
      path: request.path,
      uri: canonical.toString(),
      beforeContent: text,
      beforeHash: this.hashText(text),
    };
  }

  async isFileDeleteTargetCurrent(
    snapshot: FileDeleteTargetSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const requested = Uri.parse(snapshot.uri, true);
    const canonical = await this.#scope.validate(requested, signal);
    signal.throwIfAborted();
    if (canonical.toString() !== snapshot.uri) return false;
    try {
      const text = await this.#readText(canonical, new FileDeleteTargetNotFoundError(), signal);
      return this.hashText(text) === snapshot.beforeHash;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof FileDeleteTargetNotFoundError) return false;
      throw error;
    }
  }

  async captureFileRenameTarget(
    request: ProposeFileRenameInput,
    signal: AbortSignal,
  ): Promise<FileRenameTargetSnapshot> {
    signal.throwIfAborted();
    const sourceRequested = this.#joinPath(this.#root, request.sourcePath);
    const targetRequested = this.#joinPath(this.#root, request.targetPath);
    const source = await this.#scope.validate(sourceRequested, signal);
    signal.throwIfAborted();
    const target = await this.#scope.validateNewFile(targetRequested, signal);
    signal.throwIfAborted();
    if (source.toString() === target.toString()) {
      throw new FileRenameTargetExistsError();
    }
    await assertParentDirectory(target, signal);
    const beforeContent = await this.#readText(source, new FileRenameSourceNotFoundError(), signal);
    if (await isPresent(target, signal)) {
      throw new FileRenameTargetExistsError();
    }

    return {
      sourcePath: request.sourcePath,
      targetPath: request.targetPath,
      sourceUri: source.toString(),
      targetUri: target.toString(),
      beforeContent,
      beforeHash: this.hashText(beforeContent),
    };
  }

  async isFileRenameTargetCurrent(
    snapshot: FileRenameTargetSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const source = await this.#scope.validate(Uri.parse(snapshot.sourceUri, true), signal);
    signal.throwIfAborted();
    const target = await this.#scope.validateNewFile(Uri.parse(snapshot.targetUri, true), signal);
    signal.throwIfAborted();
    if (source.toString() !== snapshot.sourceUri || target.toString() !== snapshot.targetUri) {
      return false;
    }
    try {
      const sourceText = await this.#readText(source, new FileRenameSourceNotFoundError(), signal);
      if (await isPresent(target, signal)) return false;
      return this.hashText(sourceText) === snapshot.beforeHash;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof FileRenameSourceNotFoundError) return false;
      throw error;
    }
  }

  async #readText(target: Uri, missing: Error, signal: AbortSignal): Promise<string> {
    try {
      const stat = await workspace.fs.stat(target);
      signal.throwIfAborted();
      if ((stat.type & FileType.File) === 0 || (stat.type & FileType.Directory) !== 0) {
        throw missing;
      }
      const document = await workspace.openTextDocument(target);
      signal.throwIfAborted();
      if (document.uri.toString() !== target.toString()) throw missing;
      return document.getText();
    } catch (error) {
      signal.throwIfAborted();
      if (error === missing || isVscodeFileNotFound(error)) throw missing;
      throw error;
    }
  }
}

async function assertParentDirectory(target: Uri, signal: AbortSignal): Promise<void> {
  const separator = target.path.lastIndexOf("/");
  const parent = target.with({ path: separator <= 0 ? "/" : target.path.slice(0, separator) });
  const stat = await workspace.fs.stat(parent);
  signal.throwIfAborted();
  if ((stat.type & FileType.Directory) === 0) {
    throw new Error("The rename target parent is not a directory.");
  }
}

async function isPresent(target: Uri, signal: AbortSignal): Promise<boolean> {
  try {
    await workspace.fs.stat(target);
    signal.throwIfAborted();
    return true;
  } catch (error) {
    signal.throwIfAborted();
    if (isVscodeFileNotFound(error)) return false;
    throw error;
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
