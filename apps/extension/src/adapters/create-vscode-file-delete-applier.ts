import { createHash } from "node:crypto";

import type { Checkpoint } from "@ctrl-zebra/protocol";
import { FileType, Uri, WorkspaceEdit, workspace } from "vscode";

import {
  FileDeleteApplier,
  FileDeleteConflictError,
  type FileDeleteTarget,
} from "./file-delete-applier.js";
import { isVscodeFileNotFound } from "./vscode-file-system-error.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export function createVsCodeFileDeleteApplier(
  scope: Pick<WorkspaceScope, "validate">,
  createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>,
  createId: () => string,
  now: () => Date,
  assertCanApply: () => void,
): FileDeleteApplier<Uri, WorkspaceEdit> {
  return new FileDeleteApplier({
    async resolveTarget(serializedUri, signal): Promise<FileDeleteTarget<Uri>> {
      signal.throwIfAborted();
      const requested = Uri.parse(serializedUri, true);
      const canonical = await scope.validate(requested, signal);
      signal.throwIfAborted();
      try {
        const stat = await workspace.fs.stat(canonical);
        signal.throwIfAborted();
        if ((stat.type & FileType.File) === 0 || (stat.type & FileType.Directory) !== 0) {
          throw new FileDeleteConflictError();
        }
        const document = await workspace.openTextDocument(canonical);
        signal.throwIfAborted();
        if (document.uri.toString() !== canonical.toString()) {
          throw new FileDeleteConflictError();
        }
        return { resource: document.uri, exists: true, text: document.getText() };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof FileDeleteConflictError) throw error;
        if (isVscodeFileNotFound(error)) {
          return { resource: canonical, exists: false };
        }
        throw error;
      }
    },
    createWorkspaceEdit: () => new WorkspaceEdit(),
    deleteFile(edit, uri) {
      edit.deleteFile(uri, { recursive: false, ignoreIfNotExists: false });
    },
    assertCanApply,
    applyWorkspaceEdit: (edit) => Promise.resolve(workspace.applyEdit(edit)),
    hashText: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
    createCheckpoint,
    createId,
    now,
  });
}
