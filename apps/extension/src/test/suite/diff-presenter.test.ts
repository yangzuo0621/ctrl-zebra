import assert from "node:assert/strict";
import * as vscode from "vscode";

import { createVsCodeDiffPresenter } from "../../adapters/create-vscode-diff-presenter.js";
import { diffDocumentScheme } from "../../adapters/diff-presenter.js";

export async function verifyDiffPresenter(): Promise<void> {
  const source = await vscode.workspace.openTextDocument({
    content: "before\n",
    language: "plaintext",
  });
  const presenter = createVsCodeDiffPresenter();

  try {
    await presenter.present(
      {
        uri: source.uri.toString(),
        originalRevision: { kind: "document_version", value: source.version },
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
            newText: "after",
          },
        ],
      },
      new AbortController().signal,
    );

    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(activeTab?.input instanceof vscode.TabInputTextDiff, "Expected an active Diff tab.");
    assert.equal(activeTab.input.original.scheme, diffDocumentScheme);
    assert.equal(activeTab.input.modified.scheme, diffDocumentScheme);
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    presenter.dispose();
  }
}
