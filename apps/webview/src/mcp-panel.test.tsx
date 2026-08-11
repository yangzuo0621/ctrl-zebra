import { protocolVersion } from "@ctrl-zebra/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { McpPanel } from "./mcp-panel.js";
import { createMcpStore } from "./mcp-store.js";
import type { WebviewHost } from "./vscode-api.js";

const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;
const capabilities = {
  tools: true,
  toolsListChanged: false,
  resources: true,
  resourceTemplates: false,
  resourcesListChanged: false,
  prompts: true,
  promptsListChanged: false,
};

function createHost(): WebviewHost {
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
    refreshMcpTools: vi.fn(),
    readMcpResource: vi.fn(),
  };
}

describe("MCP panel", () => {
  it("uses progressive disclosure and expresses external source and risk in text", () => {
    const store = createMcpStore(createHost(), () => "request");
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
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-tool-catalog",
      requestId: "catalog",
      catalogSequence: 1,
      catalog: {
        server,
        generation: 1,
        tools: [
          {
            server,
            generation: 1,
            registryName: "mcp_local_fixture_delete",
            mcpToolName: "delete",
            description: "Delete data",
          },
        ],
        rejectedTools: [],
        rejectedToolsTruncated: false,
      },
    });
    render(<McpPanel store={store} />);
    const disclosure = screen.getByText("MCP Server and context").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("MCP Server and context"));
    expect(screen.getByText("Server: Local fixture")).toBeVisible();
    expect(screen.getByText("Action: delete")).toBeVisible();
    expect(screen.getByText(/side effects may be unknown/)).toBeVisible();
  });

  it("renders Resource content as inert text instead of remote HTML or images", () => {
    const store = createMcpStore(createHost(), () => "read");
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
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-resources",
      requestId: "catalog",
      catalog: {
        server,
        generation: 1,
        resources: [{ server, generation: 1, uri: "memory://unsafe", name: "Unsafe" }],
        templates: [],
      },
    });
    store.getState().readResource();
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-resource-preview",
      requestId: "read",
      status: "ready",
      snapshotId: "snapshot",
      snapshot: {
        server,
        generation: 1,
        uri: "memory://unsafe",
        mimeType: "text/plain",
        items: [{ text: '<img src="https://example.invalid/a.png">' }],
        truncated: false,
      },
    });
    render(<McpPanel store={store} />);
    expect(screen.getByText('<img src="https://example.invalid/a.png">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders bounded diagnostic recovery with fixed reason text", () => {
    const store = createMcpStore(createHost(), () => "refresh");
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
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-diagnostics",
      requestId: "diagnostic",
      diagnosticSequence: 1,
      diagnostic: {
        kind: "tool-rejections",
        outcome: "degraded",
        server,
        generation: 1,
        connectionStatus: "connected",
        skippedTools: [{ mcpToolName: "unsafe", reason: "forbidden-keyword" }],
        skippedToolsTruncated: false,
        recoveryAction: "refresh-tools",
      },
    });
    render(<McpPanel store={store} />);
    fireEvent.click(screen.getByText("MCP Server and context"));
    expect(screen.getByRole("heading", { name: "MCP diagnostics" })).toBeVisible();
    expect(screen.getByText("Unsupported schema feature.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh Tools" })).toBeVisible();
  });
});
