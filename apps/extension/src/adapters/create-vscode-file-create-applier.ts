import type { Checkpoint } from "@ctrl-zebra/protocol";
import { FileType, Position, Uri, WorkspaceEdit, workspace } from "vscode";

import {
  FileCreateApplier,
  FileCreateConflictError,
  type FileCreateTarget,
} from "./file-create-applier.js";
import { isVscodeFileNotFound } from "./vscode-file-system-error.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export function createVsCodeFileCreateApplier(
  scope: Pick<WorkspaceScope, "validateNewFile">,
  createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>,
  createId: () => string,
  now: () => Date,
  assertCanApply: () => void,
): FileCreateApplier<Uri, WorkspaceEdit> {
  return new FileCreateApplier({
    async resolveTarget(serializedUri, signal): Promise<FileCreateTarget<Uri>> {
      signal.throwIfAborted();
      const requested = Uri.parse(serializedUri, true);
      const canonical = await scope.validateNewFile(requested, signal);
      signal.throwIfAborted();
      const separator = canonical.path.lastIndexOf("/");
      const parent = canonical.with({
        path: separator <= 0 ? "/" : canonical.path.slice(0, separator),
      });
      try {
        const parentStat = await workspace.fs.stat(parent);
        signal.throwIfAborted();
        if ((parentStat.type & FileType.Directory) === 0) {
          throw new FileCreateConflictError();
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof FileCreateConflictError) throw error;
        if (isVscodeFileNotFound(error)) throw new FileCreateConflictError();
        throw error;
      }
      try {
        await workspace.fs.stat(canonical);
        signal.throwIfAborted();
        return { resource: canonical, exists: true };
      } catch (error) {
        signal.throwIfAborted();
        if (!isVscodeFileNotFound(error)) {
          throw error;
        }
        return { resource: canonical, exists: false };
      }
    },
    createWorkspaceEdit: () => new WorkspaceEdit(),
    createFile(edit, uri) {
      edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    },
    insert(edit, uri, text) {
      edit.insert(uri, new Position(0, 0), text);
    },
    assertCanApply,
    applyWorkspaceEdit: (edit) => Promise.resolve(workspace.applyEdit(edit)),
    createCheckpoint,
    createId,
    now,
  });
}
