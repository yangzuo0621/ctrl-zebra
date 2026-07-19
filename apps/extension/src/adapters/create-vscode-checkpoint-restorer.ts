import { createHash } from "node:crypto";

import type { CheckpointStore } from "@ctrl-zebra/core";
import { type Position, Range, Uri, WorkspaceEdit, workspace } from "vscode";

import { CheckpointRestorer } from "./checkpoint-restorer.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export function createVsCodeCheckpointRestorer(
  scope: Pick<WorkspaceScope, "validate">,
  checkpointStore: CheckpointStore,
): CheckpointRestorer<Uri, WorkspaceEdit> {
  return new CheckpointRestorer({
    loadCheckpoint: (checkpointId, signal) => checkpointStore.read(checkpointId, signal),
    async resolveDocument(serializedUri, signal) {
      signal.throwIfAborted();
      const canonical = await scope.validate(Uri.parse(serializedUri, true), signal);
      signal.throwIfAborted();
      const document = await workspace.openTextDocument(canonical);
      signal.throwIfAborted();
      return {
        uri: document.uri,
        text: document.getText(),
        end: toTextPosition(document.positionAt(document.getText().length)),
      };
    },
    createWorkspaceEdit: () => new WorkspaceEdit(),
    replace(edit, uri, range, text) {
      edit.replace(
        uri,
        new Range(range.start.line, range.start.character, range.end.line, range.end.character),
        text,
      );
    },
    applyWorkspaceEdit: (edit) => Promise.resolve(workspace.applyEdit(edit)),
    hashText: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
  });
}

function toTextPosition(position: Position) {
  return { line: position.line, character: position.character };
}
