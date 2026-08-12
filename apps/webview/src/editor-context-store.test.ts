import type { EditorContextMessage, IdeTextContextDto } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { createEditorContextStore } from "./editor-context-store.js";
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
} as const;

describe("editor context Webview store", () => {
  it("projects ready context into an editable draft and preserves focus-owned draft edits", () => {
    const host = createHost();
    const store = createEditorContextStore({ host, createRequestId: ids(["refresh-1"]) });
    const ready = event({ status: "ready", eventSequence: 1, context }) as Extract<
      EditorContextMessage,
      { status: "ready" }
    >;
    store.getState().receive(ready);
    expect(store.getState().card?.status).toBe("ready");
    expect(store.getState().draft).toContain("Editor context");
    store.getState().setDraft("user edited draft");
    store.getState().receive({
      ...ready,
      eventSequence: 0,
      requestId: "late",
    });
    expect(store.getState().draft).toBe("user edited draft");
  });

  it("accepts one stale event, blocks Send until Use stale, and posts the exact owner tuple", () => {
    const host = createHost();
    const store = createEditorContextStore({ host, createRequestId: ids(["use-1"]) });
    store.getState().receive(event({ status: "ready", eventSequence: 1, context }));
    store.getState().receive(
      event({
        status: "stale",
        eventSequence: 2,
        requestId: "stale",
        reason: "document-changed",
        context: { ...context, source: { ...context.source, stale: true } },
      }),
    );
    expect(store.getState().canSend()).toBe(false);
    expect(store.getState().useStale()).toBe(true);
    expect(store.getState().canSend()).toBe(true);
    expect(host.calls).toContainEqual(
      expect.objectContaining({
        type: "webview/editor-context-use-stale",
        requestId: "use-1",
        cardGeneration: 1,
        contextId: "context-1",
      }),
    );
  });

  it("compares same-sequence retransmissions before mutation and clears locally before Remove", () => {
    const host = createHost();
    const store = createEditorContextStore({ host, createRequestId: ids(["remove-1"]) });
    const ready = event({ status: "ready", eventSequence: 1, context }) as Extract<
      EditorContextMessage,
      { status: "ready" }
    >;
    store.getState().receive(ready);
    const generated = store.getState().draft;
    store.getState().receive(ready);
    expect(store.getState().draft).toBe(generated);
    store.getState().setDraft("edited");
    expect(store.getState().remove()).toBe(true);
    expect(store.getState().card).toBeUndefined();
    expect(store.getState().draft).toBe("edited");
    expect(host.calls).toContainEqual(
      expect.objectContaining({ type: "webview/editor-context-remove", requestId: "remove-1" }),
    );
  });

  it("rejects late events after Remove while allowing a newer same-session capture", () => {
    const host = createHost();
    const store = createEditorContextStore({ host, createRequestId: ids(["remove-1"]) });
    const ready = event({ status: "ready", eventSequence: 1, context }) as Extract<
      EditorContextMessage,
      { status: "ready" }
    >;
    store.getState().receive(ready);
    expect(store.getState().remove()).toBe(true);
    store.getState().receive({ ...ready, eventSequence: 2, requestId: "late" });
    expect(store.getState().card).toBeUndefined();
    store.getState().receive({
      ...ready,
      eventSequence: 3,
      requestId: "new",
      cardGeneration: 2,
      captureId: "capture-2",
      contextId: "context-2",
    });
    expect(store.getState().card?.contextId).toBe("context-2");
  });

  it("blocks Send while Refresh is pending even when the previous card is ready", () => {
    const host = createHost();
    const store = createEditorContextStore({ host, createRequestId: ids(["refresh-1"]) });
    const ready = event({ status: "ready", eventSequence: 1, context }) as Extract<
      EditorContextMessage,
      { status: "ready" }
    >;
    store.getState().receive(ready);
    expect(store.getState().canSend()).toBe(true);
    expect(store.getState().refresh()).toBe(true);
    expect(store.getState().capturePending).toBe(true);
    expect(store.getState().canSend()).toBe(false);
  });
});

function event(overrides: {
  readonly status: "ready" | "stale";
  readonly eventSequence?: number;
  readonly requestId?: string;
  readonly reason?: "document-changed";
  readonly context?: IdeTextContextDto;
  readonly cardGeneration?: number;
}): EditorContextMessage {
  const base = {
    protocolVersion: 1 as const,
    type: "extension/editor-context" as const,
    requestId: "ready",
    viewGeneration: 1,
    sessionGeneration: 0,
    eventSequence: 1,
    cardGeneration: overrides.cardGeneration ?? 1,
    captureId: "capture-1",
    contextId: "context-1",
    scope: "selection" as const,
    context,
    status: "ready" as const,
  };
  return { ...base, ...overrides } as EditorContextMessage;
}

function createHost() {
  const calls: unknown[] = [];
  const host: WebviewHost & { readonly calls: readonly unknown[] } = {
    calls,
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
    refreshEditorContext(...args) {
      calls.push({
        type: "webview/editor-context-refresh",
        requestId: args[0],
        viewGeneration: args[1],
        sessionGeneration: args[2],
        cardGeneration: args[3],
        contextId: args[4],
        scope: args[5],
      });
    },
    removeEditorContext(...args) {
      calls.push({
        type: "webview/editor-context-remove",
        requestId: args[0],
        viewGeneration: args[1],
        sessionGeneration: args[2],
        cardGeneration: args[3],
        contextId: args[4],
      });
    },
    useStaleEditorContext(...args) {
      calls.push({
        type: "webview/editor-context-use-stale",
        requestId: args[0],
        viewGeneration: args[1],
        sessionGeneration: args[2],
        cardGeneration: args[3],
        contextId: args[4],
      });
    },
  };
  return host;
}

function ids(values: readonly string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}
