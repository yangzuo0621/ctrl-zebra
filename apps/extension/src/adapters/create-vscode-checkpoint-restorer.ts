import { createHash } from "node:crypto";

import type { CheckpointStore } from "@ctrl-zebra/core";
import { Position, Range, Uri, WorkspaceEdit, workspace } from "vscode";

import { CheckpointRestorer } from "./checkpoint-restorer.js";
import { validateCheckpointTarget } from "./checkpoint-target-validation.js";
import { isVscodeFileNotFound } from "./vscode-file-system-error.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export function createVsCodeCheckpointRestorer(
  scope: Pick<WorkspaceScope, "validate" | "validateNewFile">,
  checkpointStore: CheckpointStore,
): CheckpointRestorer<Uri, WorkspaceEdit> {
  return new CheckpointRestorer({
    loadCheckpoint: (checkpointId, signal) => checkpointStore.read(checkpointId, signal),
    async resolveDocument(serializedUri, signal) {
      signal.throwIfAborted();
      const requested = Uri.parse(serializedUri, true);
      const canonical = await validateCheckpointTarget(
        scope,
        requested,
        signal,
        (target) => workspace.fs.stat(target),
        isVscodeFileNotFound,
      );
      signal.throwIfAborted();
      try {
        const document = await workspace.openTextDocument(canonical);
        signal.throwIfAborted();
        return {
          uri: document.uri,
          text: document.getText(),
          end: toTextPosition(document.positionAt(document.getText().length)),
        };
      } catch (error) {
        signal.throwIfAborted();
        if (isVscodeFileNotFound(error)) return undefined;
        throw error;
      }
    },
    createWorkspaceEdit: () => new WorkspaceEdit(),
    createResource: (serializedUri) => Uri.parse(serializedUri, true),
    replace(edit, uri, range, text) {
      edit.replace(
        uri,
        new Range(range.start.line, range.start.character, range.end.line, range.end.character),
        text,
      );
    },
    createFile(edit, uri) {
      edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    },
    insert(edit, uri, text) {
      edit.insert(uri, new Position(0, 0), text);
    },
    deleteFile(edit, uri) {
      edit.deleteFile(uri, { recursive: false, ignoreIfNotExists: false });
    },
    renameFile(edit, source, target) {
      edit.renameFile(source, target, { overwrite: false, ignoreIfExists: false });
    },
    applyWorkspaceEdit: (edit) => Promise.resolve(workspace.applyEdit(edit)),
    hashText: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
  });
}

function toTextPosition(position: Position) {
  return { line: position.line, character: position.character };
}
