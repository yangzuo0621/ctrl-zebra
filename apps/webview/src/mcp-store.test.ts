import { type McpToolCatalogMessage, protocolVersion } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { createMcpStore } from "./mcp-store.js";
import type { WebviewHost } from "./vscode-api.js";

const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;
const capabilities = {
  tools: true,
  toolsListChanged: false,
  resources: true,
  resourceTemplates: true,
  resourcesListChanged: false,
  prompts: true,
  promptsListChanged: false,
};

function host(): WebviewHost {
  return {
    submit: vi.fn(),
    cancel: vi.fn(),
    showApprovalDiff: vi.fn(),
    decideApproval: vi.fn(),
    listSessions: vi.fn(),
    restoreSession: vi.fn(),
    listCheckpoints: vi.fn(),
    restoreCheckpoint: vi.fn(),
    subscribe: () => () => {},
    connectMcp: vi.fn(),
    disconnectMcp: vi.fn(),
    refreshMcpTools: vi.fn(),
    openMcpSettings: vi.fn(),
    readMcpResource: vi.fn(),
    attachMcpResource: vi.fn(),
    detachMcpResource: vi.fn(),
    previewMcpPrompt: vi.fn(),
    confirmMcpPrompt: vi.fn(),
    cancelMcpPrompt: vi.fn(),
    detachMcpPrompt: vi.fn(),
  };
}

describe("unified MCP feature store", () => {
  it("gates Server generations and preserves only immutable draft context on disconnect", () => {
    const api = host();
    const ids = ["connect", "read", "attach", "preview", "confirm", "disconnect"];
    const store = createMcpStore(api, () => ids.shift() ?? "unexpected");
    store.getState().connect();
    expect(api.connectMcp).toHaveBeenCalledWith("connect");
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-connection",
      requestId: "connect",
      connection: {
        status: "connected",
        server,
        generation: 3,
        configurationStale: false,
        protocolVersion: "2026-07-28",
        capabilities,
      },
    });
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-resources",
      requestId: "catalog",
      catalog: {
        server,
        generation: 3,
        resources: [{ server, generation: 3, uri: "memory://a", name: "A" }],
        templates: [],
      },
    });
    expect(store.getState().readResource()).toBe(true);
    expect(api.readMcpResource).toHaveBeenCalledWith("read", "local_fixture", 3, {
      kind: "resource",
      uri: "memory://a",
    });
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-resource-preview",
      requestId: "read",
      status: "ready",
      snapshotId: "snapshot-1",
      snapshot: {
        server,
        generation: 3,
        uri: "memory://a",
        mimeType: "text/plain",
        items: [{ text: "plain text" }],
        truncated: false,
      },
    });
    expect(store.getState().attachResource()).toBe(true);
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-resource-preview",
      requestId: "attach",
      status: "attached",
      attachment: {
        snapshotId: "snapshot-1",
        serverId: "local_fixture",
        uri: "memory://a",
        mimeType: "text/plain",
        text: "plain text",
        truncated: false,
      },
    });
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompts",
      requestId: "catalog",
      catalog: {
        server,
        generation: 3,
        prompts: [{ server, generation: 3, name: "review", arguments: [] }],
      },
    });
    expect(store.getState().previewPrompt()).toBe(true);
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompt-preview",
      requestId: "preview",
      status: "ready",
      preview: {
        previewId: "preview-1",
        server,
        generation: 3,
        promptName: "review",
        arguments: {},
        messages: [{ sourceRole: "user", text: "Review this" }],
      },
    });
    expect(store.getState().confirmPrompt()).toBe(true);
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompt-preview",
      requestId: "confirm",
      status: "confirmed",
      previewId: "preview-1",
      confirmation: {
        serverId: "local_fixture",
        promptName: "review",
        projectedText: "Review this",
      },
    });
    store.getState().disconnect();
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-connection",
      requestId: "disconnect",
      connection: { status: "disconnected", server, generation: 3, configurationStale: false },
    });
    expect(store.getState()).toMatchObject({
      resources: undefined,
      prompts: undefined,
      attachments: [{ snapshotId: "snapshot-1" }],
      confirmations: [{ previewId: "preview-1" }],
    });
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-resources",
      requestId: "stale",
      catalog: { server, generation: 3, resources: [], templates: [] },
    });
    expect(store.getState().resources).toBeUndefined();

    store.getState().clearDraft();
    expect(store.getState()).toMatchObject({
      attachments: [],
      confirmations: [],
      resourcePreview: undefined,
      promptPreview: undefined,
      announcement: "MCP draft context cleared.",
    });
  });

  it("keeps selection on refresh and rejects missing required Template arguments", () => {
    const api = host();
    const store = createMcpStore(api, () => "request");
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-connection",
      requestId: "initial",
      connection: {
        status: "connected",
        server,
        generation: 1,
        configurationStale: false,
        protocolVersion: "2026-07-28",
        capabilities,
      },
    });
    const catalog = {
      server,
      generation: 1,
      resources: [],
      templates: [
        {
          server,
          generation: 1,
          uriTemplate: "memory://{name}",
          name: "By name",
          arguments: [{ name: "name", required: true as const }],
        },
      ],
    };
    store
      .getState()
      .receive({ protocolVersion, type: "extension/mcp-resources", requestId: "first", catalog });
    expect(store.getState().readResource()).toBe(false);
    store.getState().setResourceArgument("name", "alpha");
    expect(store.getState().readResource()).toBe(true);
    store
      .getState()
      .receive({ protocolVersion, type: "extension/mcp-resources", requestId: "refresh", catalog });
    expect(store.getState().selectedResourceKey).toBe("template:memory://{name}");
  });

  it("commits one atomic catalog and ignores the unchanged legacy projection", () => {
    const store = createMcpStore(host(), () => "request");
    receiveConnection(store, 1);
    const catalog = toolCatalog(1, 1, "lookup");
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-tool-catalog",
      requestId: "catalog-a",
      catalogSequence: 1,
      catalog,
    });
    expect(store.getState().tools).toEqual(catalog);
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-tools",
      requestId: "catalog-a",
      catalog: { server, generation: 1, tools: catalog.tools },
    });
    expect(store.getState().tools).toEqual(catalog);
  });

  it("ignores post-commit stale A, commits legal higher C, and rejects conflicting duplicates", () => {
    const store = createMcpStore(host(), () => "request");
    receiveConnection(store, 1);
    const catalogA = toolCatalog(1, 1, "first");
    const catalogB = toolCatalog(1, 1, "second");
    const catalogC = toolCatalog(1, 1, "third");

    receiveCatalog(store, "A", 1, catalogA);
    receiveCatalog(store, "B", 2, catalogB);
    receiveCatalog(store, "A", 1, catalogA);
    expect(store.getState().tools).toEqual(catalogB);

    receiveCatalog(store, "A-conflict", 1, catalogA);
    expect(store.getState().tools).toEqual(catalogB);

    receiveCatalog(store, "C", 3, catalogC);
    expect(store.getState().tools).toEqual(catalogC);
  });

  it("treats exact duplicates as no-ops at pending and committed watermarks", () => {
    const store = createMcpStore(host(), () => "request");
    receiveConnection(store, 1);
    const catalog = toolCatalog(1, 1, "lookup");
    let replayed = false;
    const unsubscribe = store.subscribe((state) => {
      if (!replayed && state.tools === catalog) {
        replayed = true;
        receiveCatalog(store, "A", 1, catalog);
      }
    });
    receiveCatalog(store, "A", 1, catalog);
    unsubscribe();
    expect(store.getState().tools).toEqual(catalog);

    receiveCatalog(store, "A", 1, catalog);
    expect(store.getState().tools).toEqual(catalog);
  });

  it("discards pending conflicts and lets a reentrant higher sequence win", () => {
    const conflictStore = createMcpStore(host(), () => "request");
    receiveConnection(conflictStore, 1);
    const first = toolCatalog(1, 1, "first");
    const conflict = toolCatalog(1, 1, "conflict");
    let replayedConflict = false;
    const unsubscribeConflict = conflictStore.subscribe((state) => {
      if (!replayedConflict && state.tools === first) {
        replayedConflict = true;
        receiveCatalog(conflictStore, "conflict", 1, conflict);
      }
    });
    receiveCatalog(conflictStore, "A", 1, first);
    unsubscribeConflict();
    expect(conflictStore.getState().tools).toEqual(first);

    const higherStore = createMcpStore(host(), () => "request");
    receiveConnection(higherStore, 1);
    const higher = toolCatalog(1, 2, "higher");
    let replayedHigher = false;
    const unsubscribeHigher = higherStore.subscribe((state) => {
      if (!replayedHigher && state.tools === first) {
        replayedHigher = true;
        receiveCatalog(higherStore, "B", 2, higher);
      }
    });
    receiveCatalog(higherStore, "A", 1, first);
    unsubscribeHigher();
    expect(higherStore.getState().tools).toEqual(higher);
  });

  it("discards same-sequence conflicts without replacing the committed catalog", () => {
    const store = createMcpStore(host(), () => "request");
    receiveConnection(store, 1);
    const catalog = toolCatalog(1, 1, "stable");
    receiveCatalog(store, "A", 1, catalog);
    receiveCatalog(store, "different-request", 1, toolCatalog(1, 1, "conflict"));
    expect(store.getState().tools).toEqual(catalog);
  });

  it("resets sequence watermarks on generation change and disconnect", () => {
    const store = createMcpStore(host(), () => "request");
    receiveConnection(store, 1);
    const first = toolCatalog(1, 1, "first");
    receiveCatalog(store, "A", 9, first);
    receiveConnection(store, 2);
    const second = toolCatalog(2, 1, "second");
    receiveCatalog(store, "B", 1, second);
    expect(store.getState().tools).toEqual(second);

    store.getState().disconnect();
    receiveCatalog(store, "late-before-status", 2, second);
    expect(store.getState().tools).toEqual(second);

    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-connection",
      requestId: "request",
      connection: { status: "disconnected", server, generation: 2, configurationStale: false },
    });
    receiveCatalog(store, "late", 2, second);
    expect(store.getState().tools).toBeUndefined();
  });

  it("ignores a wrong-scope catalog before sequence handling", () => {
    const store = createMcpStore(host(), () => "request");
    receiveConnection(store, 1);
    receiveCatalog(store, "wrong", 99, toolCatalog(2, 1, "wrong"));
    expect(store.getState().tools).toBeUndefined();
  });

  it("keeps the ordinary connected path quiet when the diagnostic replacement is clear", () => {
    const store = createMcpStore(host(), () => "request");
    receiveConnection(store, 1);
    const connectedAnnouncement = store.getState().announcement;
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-diagnostics",
      requestId: "catalog",
      diagnosticSequence: 1,
      diagnostic: { kind: "clear", server, generation: 1 },
    });
    expect(store.getState().diagnostics).toBeUndefined();
    expect(store.getState().announcement).toBe(connectedAnnouncement);
    expect(store.getState().diagnosticAnnouncement).toBeUndefined();
  });

  it("sequences diagnostics, keeps conflicting duplicates local, and clears on connection cleanup", () => {
    const api = host();
    const store = createMcpStore(api, () => "refresh");
    receiveConnection(store, 1);
    expect(store.getState().refreshTools()).toBe(true);
    expect(api.refreshMcpTools).toHaveBeenCalledWith("refresh", server.serverId, 1);
    const diagnostic = {
      kind: "tool-rejections" as const,
      outcome: "degraded" as const,
      server,
      generation: 1,
      connectionStatus: "connected" as const,
      skippedTools: [{ mcpToolName: "unsafe", reason: "schema-invalid" as const }],
      skippedToolsTruncated: false,
      recoveryAction: "refresh-tools" as const,
    };
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-diagnostics",
      requestId: "refresh",
      diagnosticSequence: 1,
      diagnostic,
    });
    expect(store.getState().diagnostics).toEqual(diagnostic);
    expect(store.getState().busy).toBeUndefined();
    store.setState({ busy: "resource" });
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-diagnostics",
      requestId: "poll",
      diagnosticSequence: 2,
      diagnostic,
    });
    expect(store.getState().busy).toBe("resource");
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-diagnostics",
      requestId: "conflict",
      diagnosticSequence: 1,
      diagnostic: { kind: "clear", server, generation: 1 },
    });
    expect(store.getState().diagnostics).toEqual(diagnostic);
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-connection",
      requestId: "disconnect",
      connection: { status: "disconnected", server, generation: 1, configurationStale: false },
    });
    expect(store.getState().diagnostics).toBeUndefined();
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-diagnostics",
      requestId: "late",
      diagnosticSequence: 2,
      diagnostic,
    });
    expect(store.getState().diagnostics).toBeUndefined();
  });
});

function receiveConnection(store: ReturnType<typeof createMcpStore>, generation: number): void {
  store.getState().receive({
    protocolVersion,
    type: "extension/mcp-connection",
    requestId: `connection-${generation}`,
    connection: {
      status: "connected",
      server,
      generation,
      configurationStale: false,
      protocolVersion: "2026-07-28",
      capabilities,
    },
  });
}

function toolCatalog(
  generation: number,
  _sequenceHint: number,
  name: string,
): McpToolCatalogMessage["catalog"] {
  return {
    server,
    generation,
    tools: [
      {
        server,
        generation,
        registryName: `mcp_local_fixture_${name}`,
        mcpToolName: name,
      },
    ],
    rejectedTools: [],
    rejectedToolsTruncated: false,
  };
}

function receiveCatalog(
  store: ReturnType<typeof createMcpStore>,
  requestId: string,
  catalogSequence: number,
  catalog: McpToolCatalogMessage["catalog"],
): void {
  store.getState().receive({
    protocolVersion,
    type: "extension/mcp-tool-catalog",
    requestId,
    catalogSequence,
    catalog,
  });
}
