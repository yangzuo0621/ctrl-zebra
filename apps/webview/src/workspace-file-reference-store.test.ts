import type { WebviewToExtensionMessage, WorkspaceFileReference } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";
import type { WebviewHost } from "./vscode-api.js";
import { createWorkspaceFileReferenceStore } from "./workspace-file-reference-store.js";

const context = (path: string, stale = false): WorkspaceFileReference => ({
  referenceId: `ref-${path}`,
  context: {
    source: {
      uri: { scheme: "file", authority: "", path },
      stale,
      truncated: false,
    },
    text: "const value = 1;",
  },
});

describe("workspace file reference Webview store", () => {
  it("tracks the latest search request and projects ready references", () => {
    const calls: WebviewToExtensionMessage[] = [];
    const host = createHost(calls);
    let nextId = 0;
    const store = createWorkspaceFileReferenceStore({
      host,
      createRequestId: () => `request-${++nextId}`,
    });

    store.getState().search("src");
    expect(calls[0]).toMatchObject({
      type: "webview/workspace-file-search",
      requestId: "request-1",
    });
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/workspace-file-search",
      requestId: "request-1",
      status: "ready",
      results: [{ path: "src/index.ts" }],
      truncated: false,
    });
    expect(store.getState().suggestions).toEqual([{ path: "src/index.ts" }]);

    store.getState().read("src/index.ts");
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId: "request-2",
      status: "ready",
      reference: context("src/index.ts"),
    });
    expect(store.getState().cards).toHaveLength(1);
    expect(store.getState().canSend()).toBe(true);
  });

  it("blocks Send for stale references until Use stale and removes duplicates by path", () => {
    const calls: WebviewToExtensionMessage[] = [];
    const store = createWorkspaceFileReferenceStore({
      host: createHost(calls),
      createRequestId: (() => {
        let next = 0;
        return () => `request-${++next}`;
      })(),
    });
    const stale = context("src/index.ts", true);
    store.getState().read("src/index.ts");
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId: "request-1",
      status: "stale",
      reference: stale,
      reason: "changed",
    });
    expect(store.getState().canSend()).toBe(false);
    expect(store.getState().useStale(stale.referenceId)).toBe(true);
    expect(store.getState().canSend()).toBe(true);
    expect(calls.at(-1)).toMatchObject({ type: "webview/workspace-file-use-stale" });

    store.getState().receive({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId: "ready-2",
      status: "ready",
      reference: { ...stale, referenceId: "ref-duplicate" },
    });
    expect(store.getState().cards).toHaveLength(1);
  });

  it("clears local cards before a new Session and accepts removal", () => {
    const calls: WebviewToExtensionMessage[] = [];
    const store = createWorkspaceFileReferenceStore({
      host: createHost(calls),
      createRequestId: (() => {
        let next = 0;
        return () => `request-${++next}`;
      })(),
    });
    const ready = context("README.md");
    store.getState().read("README.md");
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId: "request-1",
      status: "ready",
      reference: ready,
    });
    expect(store.getState().remove(ready.referenceId)).toBe(true);
    expect(store.getState().cards).toEqual([]);
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId: "late",
      status: "ready",
      reference: ready,
    });
    expect(store.getState().cards).toEqual([]);
    store.getState().clearForSessionSwitch();
    expect(store.getState().cards).toEqual([]);
    store.getState().receive({
      protocolVersion: 1,
      type: "extension/workspace-file-reference",
      requestId: "late-after-session",
      status: "ready",
      reference: context("src/other.ts"),
    });
    expect(store.getState().cards).toEqual([]);
  });
});

function createHost(calls: WebviewToExtensionMessage[]): WebviewHost {
  return {
    submit() {},
    cancel() {},
    showApprovalDiff() {},
    decideApproval() {},
    listSessions() {},
    restoreSession() {},
    listCheckpoints() {},
    restoreCheckpoint() {},
    subscribe() {
      return () => {};
    },
    searchWorkspaceFiles(requestId, query) {
      calls.push({ protocolVersion: 1, type: "webview/workspace-file-search", requestId, query });
    },
    readWorkspaceFile(requestId, path) {
      calls.push({ protocolVersion: 1, type: "webview/workspace-file-read", requestId, path });
    },
    removeWorkspaceFile(requestId, referenceId) {
      calls.push({
        protocolVersion: 1,
        type: "webview/workspace-file-remove",
        requestId,
        referenceId,
      });
    },
    useStaleWorkspaceFile(requestId, referenceId) {
      calls.push({
        protocolVersion: 1,
        type: "webview/workspace-file-use-stale",
        requestId,
        referenceId,
      });
    },
  };
}
