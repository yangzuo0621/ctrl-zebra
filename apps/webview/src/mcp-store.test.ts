import { protocolVersion } from "@ctrl-zebra/protocol";
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
});
