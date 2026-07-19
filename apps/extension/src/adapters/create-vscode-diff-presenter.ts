import { createHash } from "node:crypto";

import { commands, Uri, workspace } from "vscode";

import { DiffPresenter, diffDocumentScheme } from "./diff-presenter.js";

export function createVsCodeDiffPresenter(): DiffPresenter {
  let nextId = 0;

  return new DiffPresenter({
    async openSourceDocument(serializedUri, signal) {
      signal.throwIfAborted();
      const document = await workspace.openTextDocument(Uri.parse(serializedUri, true));
      signal.throwIfAborted();
      return {
        uri: document.uri,
        version: document.version,
        text: document.getText(),
        label: workspace.asRelativePath(document.uri, false),
      };
    },
    createVirtualUri(id, side, label) {
      const safeLabel = label.replaceAll(/[^a-zA-Z0-9._-]/gu, "-");
      return Uri.from({
        scheme: diffDocumentScheme,
        path: `/${id}/${side}/${safeLabel}`,
      });
    },
    registerContentProvider(provider) {
      return workspace.registerTextDocumentContentProvider(diffDocumentScheme, {
        provideTextDocumentContent: (uri) => provider.provideTextDocumentContent(uri),
      });
    },
    onDidCloseDocument(listener) {
      return workspace.onDidCloseTextDocument((document) => listener(document.uri));
    },
    async showDiff(before, after, title) {
      await commands.executeCommand("vscode.diff", before, after, title, { preview: true });
    },
    hashText(text) {
      return createHash("sha256").update(text, "utf8").digest("hex");
    },
    nextId() {
      nextId += 1;
      return String(nextId);
    },
  });
}
