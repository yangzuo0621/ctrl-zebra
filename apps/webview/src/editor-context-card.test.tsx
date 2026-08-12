import type { EditorContextMessage, IdeTextContextDto } from "@ctrl-zebra/protocol";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EditorContextCard } from "./editor-context-card.js";
import { createEditorContextStore } from "./editor-context-store.js";
import { strings } from "./strings.js";
import type { WebviewHost } from "./vscode-api.js";

const context: IdeTextContextDto = {
  source: {
    uri: { scheme: "file", authority: "", path: "src/index.ts" },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
    languageId: "typescript",
    documentVersion: 1,
    stale: false,
    truncated: false,
  },
  text: "const",
};

describe("EditorContextCard", () => {
  it("renders a semantic source card with keyboard-operable controls and no duplicate live region", () => {
    const store = createEditorContextStore({ host: createHost() });
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/editor-context",
      requestId: "ready-1",
      viewGeneration: 1,
      sessionGeneration: 0,
      eventSequence: 1,
      status: "ready",
      cardGeneration: 1,
      captureId: "capture-1",
      contextId: "context-1",
      scope: "selection",
      context,
    } satisfies Extract<EditorContextMessage, { status: "ready" }>);

    const { container } = render(<EditorContextCard store={store} />);

    expect(screen.getByRole("region", { name: strings.editorContext.cardLabel })).toBeVisible();
    expect(screen.getByRole("button", { name: strings.editorContext.refresh })).toBeEnabled();
    expect(screen.getByRole("button", { name: strings.editorContext.remove })).toBeEnabled();
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
  });
});

function createHost(): WebviewHost {
  return {
    subscribe() {
      return () => {};
    },
    submit() {},
    cancel() {},
    showApprovalDiff() {},
    decideApproval() {},
    listSessions() {},
    restoreSession() {},
    listCheckpoints() {},
    restoreCheckpoint() {},
  };
}
