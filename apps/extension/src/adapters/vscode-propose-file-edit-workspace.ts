import { createHash } from "node:crypto";

import type { FileEditRevisionSnapshot, ProposeFileEditWorkspace } from "@ctrl-zebra/builtin-tools";
import { Uri, workspace } from "vscode";

import type { JoinWorkspacePath } from "./workspace-file-reader.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export class VsCodeProposeFileEditWorkspace implements ProposeFileEditWorkspace {
  readonly #root: Uri;
  readonly #scope: WorkspaceScope;
  readonly #joinPath: JoinWorkspacePath;

  constructor(root: Uri, scope: WorkspaceScope, joinPath: JoinWorkspacePath) {
    this.#root = root;
    this.#scope = scope;
    this.#joinPath = joinPath;
  }

  async captureFileRevision(
    request: { readonly path: string },
    signal: AbortSignal,
  ): Promise<FileEditRevisionSnapshot> {
    signal.throwIfAborted();
    const target = this.#joinPath(this.#root, request.path);
    const canonical = await this.#scope.validate(target, signal);
    signal.throwIfAborted();
    const document = await workspace.openTextDocument(canonical);
    signal.throwIfAborted();
    return {
      uri: document.uri.toString(),
      revision: {
        kind: "content_hash",
        algorithm: "sha256",
        value: hashText(document.getText()),
      },
    };
  }

  async isFileRevisionCurrent(
    snapshot: FileEditRevisionSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const requested = Uri.parse(snapshot.uri, true);
    const canonical = await this.#scope.validate(requested, signal);
    signal.throwIfAborted();
    if (canonical.toString() !== snapshot.uri) {
      return false;
    }

    const document = await workspace.openTextDocument(canonical);
    signal.throwIfAborted();
    const revision = snapshot.revision;
    return revision.kind === "document_version"
      ? document.version === revision.value
      : hashText(document.getText()) === revision.value;
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
