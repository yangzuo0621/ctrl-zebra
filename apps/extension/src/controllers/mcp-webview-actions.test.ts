import { ToolRegistry } from "@ctrl-zebra/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { McpConnectionSnapshot } from "./mcp-connection-controller.js";
import { McpWebviewActions } from "./mcp-webview-actions.js";

describe("MCP Webview actions", () => {
  afterEach(() => vi.useRealTimers());

  it("publishes changed Host state once and cleans up its owned polling timer", () => {
    vi.useFakeTimers();
    let snapshot: McpConnectionSnapshot = {
      status: "disconnected",
      generation: 0,
      configurationStale: false,
    };
    const post = vi.fn();
    const actions = new McpWebviewActions({
      connection: {
        getState: () => snapshot,
        getToolSnapshot: () => undefined,
        getResourceCatalog: () => undefined,
        getPromptCatalog: () => undefined,
        connect: async () => snapshot,
        disconnect: async () => snapshot,
      },
      openSettings: vi.fn(),
    });
    actions.bind(post);
    vi.advanceTimersByTime(500);
    expect(post).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(post).toHaveBeenCalledTimes(1);
    snapshot = { ...snapshot, configurationStale: true };
    vi.advanceTimersByTime(500);
    expect(post).toHaveBeenCalledTimes(2);
    actions.dispose();
    vi.advanceTimersByTime(1_000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("force-publishes current state for the post-subscription ping handshake", () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const actions = new McpWebviewActions({
      connection: {
        getState: () => ({ status: "disconnected", generation: 0, configurationStale: false }),
        getToolSnapshot: () => undefined,
        getResourceCatalog: () => undefined,
        getPromptCatalog: () => undefined,
        connect: async () => ({ status: "disconnected", generation: 0, configurationStale: false }),
        disconnect: async () => ({
          status: "disconnected",
          generation: 0,
          configurationStale: false,
        }),
      },
      openSettings: vi.fn(),
    });
    actions.bind(post);
    actions.refresh("ping-1");
    actions.refresh("ping-2");
    expect(post.mock.calls.map(([message]) => message.requestId)).toEqual(["ping-1", "ping-2"]);
    actions.dispose();
  });

  it("publishes accepted Tools and bounded rejections as a matching pair", () => {
    const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;
    const snapshot: McpConnectionSnapshot = {
      status: "connected",
      generation: 3,
      server,
      configurationStale: false,
      connection: {
        status: "connected",
        protocolVersion: "2026-07-28",
        capabilities: {
          tools: true,
          toolsListChanged: false,
          resources: false,
          resourceTemplates: false,
          resourcesListChanged: false,
          prompts: false,
          promptsListChanged: false,
        },
      },
    };
    const tools = {
      server,
      generation: 3,
      tools: [
        {
          registryName: "mcp_local_fixture_lookup",
          mcpToolName: "lookup",
          schemaId: "schema-1",
        },
      ],
      rejectedTools: [{ mcpToolName: "unsafe", reason: "schema-invalid" as const }],
      rejectedToolsTruncated: false,
      registry: new ToolRegistry(),
    };
    const post = vi.fn();
    const actions = new McpWebviewActions({
      connection: {
        getState: () => snapshot,
        getToolSnapshot: () => tools,
        getResourceCatalog: () => undefined,
        getPromptCatalog: () => undefined,
        connect: async () => snapshot,
        disconnect: async () => snapshot,
      },
      openSettings: vi.fn(),
    });
    actions.bind(post);
    actions.refresh("catalog");

    const toolMessages = post.mock.calls
      .map(([message]) => message)
      .filter(
        (message) =>
          message.type === "extension/mcp-tools" ||
          message.type === "extension/mcp-tool-rejections",
      );
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((message) => message.requestId)).toEqual(["catalog", "catalog"]);
    expect(toolMessages[0]).toMatchObject({ type: "extension/mcp-tools" });
    expect(toolMessages[1]).toMatchObject({
      type: "extension/mcp-tool-rejections",
      catalog: { rejectedTools: [{ mcpToolName: "unsafe", reason: "schema-invalid" }] },
    });
    actions.dispose();
  });
});
