import { createHash } from "node:crypto";

import type { Checkpoint } from "@ctrl-zebra/protocol";
import { FileType, Uri, WorkspaceEdit, workspace } from "vscode";

import {
  FileRenameApplier,
  FileRenameConflictError,
  type FileRenameTarget,
} from "./file-rename-applier.js";
import { isVscodeFileNotFound } from "./vscode-file-system-error.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export function createVsCodeFileRenameApplier(
  scope: Pick<WorkspaceScope, "validate" | "validateNewFile">,
  createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>,
  createId: () => string,
  now: () => Date,
  assertCanApply: () => void,
): FileRenameApplier<Uri, WorkspaceEdit> {
  return new FileRenameApplier({
    async resolveTarget(serializedUri, signal): Promise<FileRenameTarget<Uri>> {
      signal.throwIfAborted();
      const requested = Uri.parse(serializedUri, true);
      const canonical = await resolveCanonical(scope, requested, signal);
      signal.throwIfAborted();
      try {
        const stat = await workspace.fs.stat(canonical);
        signal.throwIfAborted();
        if ((stat.type & FileType.Directory) !== 0 || (stat.type & FileType.File) === 0) {
          return { resource: canonical, exists: true };
        }
        const document = await workspace.openTextDocument(canonical);
        signal.throwIfAborted();
        if (document.uri.toString() !== canonical.toString()) {
          throw new FileRenameConflictError();
        }
        return { resource: document.uri, exists: true, text: document.getText() };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof FileRenameConflictError) throw error;
        if (isVscodeFileNotFound(error)) return { resource: canonical, exists: false };
        throw error;
      }
    },
    createWorkspaceEdit: () => new WorkspaceEdit(),
    renameFile(edit, source, target) {
      edit.renameFile(source, target, { overwrite: false, ignoreIfExists: false });
    },
    assertCanApply,
    applyWorkspaceEdit: (edit) => Promise.resolve(workspace.applyEdit(edit)),
    hashText: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
    createCheckpoint,
    createId,
    now,
  });
}

async function resolveCanonical(
  scope: Pick<WorkspaceScope, "validate" | "validateNewFile">,
  requested: Uri,
  signal: AbortSignal,
): Promise<Uri> {
  try {
    return await scope.validate(requested, signal);
  } catch (_error) {
    signal.throwIfAborted();
    return scope.validateNewFile(requested, signal);
  }
}
