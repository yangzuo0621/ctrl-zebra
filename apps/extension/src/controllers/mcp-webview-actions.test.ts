import { ToolRegistry } from "@ctrl-zebra/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { McpConnectionSnapshot } from "./mcp-connection-controller.js";
import { McpWebviewActions, nextMcpCatalogSequence } from "./mcp-webview-actions.js";

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

  it("publishes one sequenced combined catalog before unchanged legacy Tools", () => {
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
          message.type === "extension/mcp-tools" || message.type === "extension/mcp-tool-catalog",
      );
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((message) => message.requestId)).toEqual(["catalog", "catalog"]);
    expect(toolMessages[0]).toMatchObject({
      type: "extension/mcp-tool-catalog",
      catalogSequence: 1,
    });
    expect(toolMessages[1]).toMatchObject({
      type: "extension/mcp-tools",
      catalog: { tools: [{ mcpToolName: "lookup" }] },
    });
    actions.dispose();
  });

  it("increments catalogSequence for a forced publication and resets it by generation", () => {
    const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;
    let snapshot: McpConnectionSnapshot = {
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
      tools: [],
      rejectedTools: [],
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
    actions.refresh("first");
    actions.refresh("second");
    const sequences = post.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "extension/mcp-tool-catalog")
      .map((message) => message.catalogSequence);
    expect(sequences).toEqual([1, 2]);

    snapshot = { ...snapshot, generation: 4 };
    actions.refresh("third");
    const resetSequence = post.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "extension/mcp-tool-catalog")
      .at(-1)?.catalogSequence;
    expect(resetSequence).toBe(1);
    actions.dispose();
  });

  it("closes the sequence gate at the safe-integer boundary", () => {
    expect(nextMcpCatalogSequence(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(nextMcpCatalogSequence(Number.MAX_SAFE_INTEGER)).toBeUndefined();
    expect(nextMcpCatalogSequence(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it("disconnects and resets the generation after overflow before an explicit reconnect", async () => {
    const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;
    const connectionState = {
      protocolVersion: "2026-07-28" as const,
      capabilities: {
        tools: true,
        toolsListChanged: false,
        resources: false,
        resourceTemplates: false,
        resourcesListChanged: false,
        prompts: false,
        promptsListChanged: false,
      },
    };
    let snapshot: McpConnectionSnapshot = {
      status: "connected",
      generation: 3,
      server,
      configurationStale: false,
      connection: { status: "connected", ...connectionState },
    };
    const createTools = (generation: number) => ({
      server,
      generation,
      tools: [],
      rejectedTools: [],
      rejectedToolsTruncated: false,
      registry: new ToolRegistry(),
    });
    let toolSnapshot: ReturnType<typeof createTools> | undefined = createTools(3);
    const disconnect = vi.fn(async () => {
      toolSnapshot = undefined;
      snapshot = { ...snapshot, status: "disconnected", connection: undefined };
      return snapshot;
    });
    const connect = vi.fn(async () => {
      toolSnapshot = createTools(4);
      snapshot = {
        ...snapshot,
        status: "connected",
        generation: 4,
        connection: { status: "connected", ...connectionState },
      };
      return snapshot;
    });
    const post = vi.fn();
    const actions = new McpWebviewActions(
      {
        connection: {
          getState: () => snapshot,
          getToolSnapshot: () => toolSnapshot,
          getResourceCatalog: () => undefined,
          getPromptCatalog: () => undefined,
          connect,
          disconnect,
        },
        openSettings: vi.fn(),
      },
      {
        initialCatalogScope: `${server.serverId}\u00003`,
        initialCatalogSequence: Number.MAX_SAFE_INTEGER,
      },
    );
    actions.bind(post);
    actions.refresh("overflow");
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(snapshot.status).toBe("disconnected");
    expect(toolSnapshot).toBeUndefined();
    expect(
      post.mock.calls.some(
        ([message]) =>
          message.type === "extension/mcp-tool-catalog" || message.type === "extension/mcp-tools",
      ),
    ).toBe(false);

    actions.refresh("blocked");
    expect(
      post.mock.calls.some(
        ([message]) =>
          message.type === "extension/mcp-tool-catalog" && message.requestId === "blocked",
      ),
    ).toBe(false);

    await actions.connect("reconnect");
    const combined = post.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "extension/mcp-tool-catalog")
      .at(-1);
    expect(combined).toMatchObject({ requestId: "reconnect", catalogSequence: 1 });
    expect(snapshot.generation).toBe(4);
    actions.dispose();
  });

  it("emits neither combined nor legacy catalog when the strict envelope exceeds 1 MiB", () => {
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
    let tools = {
      server,
      generation: 3,
      tools: Array.from({ length: 20 }, (_, index) => ({
        registryName: `mcp_local_fixture_tool_${index}`,
        mcpToolName: `tool-${index}`,
        title: "x".repeat(60_000),
        schemaId: `schema-${index}`,
      })),
      rejectedTools: [],
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
    actions.refresh("oversized");
    expect(
      post.mock.calls.some(
        ([message]) =>
          message.type === "extension/mcp-tool-catalog" || message.type === "extension/mcp-tools",
      ),
    ).toBe(false);
    tools = { ...tools, tools: [] };
    actions.refresh("valid");
    const combined = post.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "extension/mcp-tool-catalog");
    expect(combined).toMatchObject({ requestId: "valid", catalogSequence: 1 });
    actions.dispose();
  });

  it("publishes protocol incompatibility diagnostics without probe or fallback claims", () => {
    const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;
    const snapshot: McpConnectionSnapshot = {
      status: "failed",
      generation: 3,
      server,
      configurationStale: false,
      error: {
        code: "protocol-incompatible",
        message: "The MCP Server does not support the required protocol version.",
      },
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
    actions.refresh("incompatible");
    const diagnostic = post.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "extension/mcp-diagnostics");
    expect(diagnostic).toMatchObject({
      diagnostic: {
        kind: "protocol-incompatible",
        configuredMode: "modern-only",
        supportedVersions: ["2026-07-28"],
        connectionEstablished: false,
        nextStep: "open-settings",
      },
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/probe|fallback|negotiated/i);
    actions.dispose();
  });

  it("publishes bounded all-rejected diagnostics after failed initial discovery", () => {
    const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;
    const snapshot: McpConnectionSnapshot = {
      status: "failed",
      generation: 3,
      server,
      configurationStale: false,
      error: { code: "invalid-schema", message: "The MCP Server supplied an invalid schema." },
    };
    const post = vi.fn();
    const actions = new McpWebviewActions({
      connection: {
        getState: () => snapshot,
        getToolSnapshot: () => undefined,
        getToolDiagnostic: () => ({
          kind: "rejections",
          rejectedTools: [
            { mcpToolName: "unsafe", reason: "forbidden-keyword" as const },
            { mcpToolName: "unsafe", reason: "forbidden-keyword" as const },
          ],
          rejectedToolsTruncated: true,
        }),
        getResourceCatalog: () => undefined,
        getPromptCatalog: () => undefined,
        connect: async () => snapshot,
        disconnect: async () => snapshot,
      },
      openSettings: vi.fn(),
    });
    actions.bind(post);
    actions.refresh("initial-failure");
    const diagnostic = post.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "extension/mcp-diagnostics");
    expect(diagnostic).toMatchObject({
      diagnostic: {
        kind: "tool-rejections",
        outcome: "all-rejected",
        connectionStatus: "failed",
        skippedTools: [{ mcpToolName: "unsafe", reason: "forbidden-keyword" }],
        skippedToolsTruncated: true,
        recoveryAction: "reconnect",
      },
    });
    actions.dispose();
  });
});
