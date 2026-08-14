import { createHash } from "node:crypto";

import type { Checkpoint } from "@ctrl-zebra/protocol";
import { Position, Range, Uri, WorkspaceEdit, workspace } from "vscode";
import {
  assertSupportedWorkspaceDocument,
  readSupportedWorkspaceText,
} from "./vscode-propose-file-edit-workspace.js";
import { WorkspaceEditApplier } from "./workspace-edit-applier.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export interface VsCodeWorkspaceEditApplierOptions {
  readonly requireSupportedText?: boolean;
}

export function createVsCodeWorkspaceEditApplier(
  scope: Pick<WorkspaceScope, "validate">,
  createCheckpoint: (checkpoint: Checkpoint, signal: AbortSignal) => Promise<void>,
  createId: () => string,
  now: () => Date,
  assertCanApply: () => void,
  options: VsCodeWorkspaceEditApplierOptions = {},
): WorkspaceEditApplier<Uri, WorkspaceEdit> {
  return new WorkspaceEditApplier({
    async resolveDocument(serializedUri, signal) {
      signal.throwIfAborted();
      const requested = Uri.parse(serializedUri, true);
      const canonical = await scope.validate(requested, signal);
      signal.throwIfAborted();
      const rawText = options.requireSupportedText
        ? await readSupportedWorkspaceText(canonical, signal)
        : undefined;
      const document = await workspace.openTextDocument(canonical);
      signal.throwIfAborted();
      if (rawText !== undefined) {
        assertSupportedWorkspaceDocument(document, rawText);
      }
      return {
        uri: document.uri,
        version: document.version,
        text: document.getText(),
        isValidPosition(position) {
          const candidate = new Position(position.line, position.character);
          return document.validatePosition(candidate).isEqual(candidate);
        },
        offsetAt: (position) => document.offsetAt(new Position(position.line, position.character)),
      };
    },
    createWorkspaceEdit: () => new WorkspaceEdit(),
    replace(edit, uri, range, newText) {
      edit.replace(
        uri,
        new Range(range.start.line, range.start.character, range.end.line, range.end.character),
        newText,
      );
    },
    assertCanApply,
    applyWorkspaceEdit: (edit) => Promise.resolve(workspace.applyEdit(edit)),
    hashText: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
    createId,
    now,
    createCheckpoint,
  });
}
