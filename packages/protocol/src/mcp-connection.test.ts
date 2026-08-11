import { describe, expect, it } from "vitest";

import {
  mcpConnectionSchema,
  mcpToolCatalogProjectionSchema,
  mcpToolCatalogSchema,
  toolStateSourceSchema,
} from "./mcp-connection.js";
import {
  extensionToWebviewMessageSchema,
  mcpDiagnosticsMessageSchema,
  mcpToolCatalogMessageSchema,
  protocolVersion,
  webviewToExtensionMessageSchema,
} from "./messages.js";

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

const tools = [
  {
    server,
    generation: 2,
    registryName: "mcp_local_fixture_lookup",
    mcpToolName: "lookup",
  },
] as const;

describe("MCP connection Protocol", () => {
  it("accepts bounded connection, catalogs, source, and explicit user intents", () => {
    expect(
      mcpConnectionSchema.parse({
        status: "connected",
        server,
        generation: 2,
        configurationStale: false,
        protocolVersion: "2026-07-28",
        capabilities,
      }),
    ).toMatchObject({ status: "connected" });
    expect(mcpToolCatalogSchema.parse({ server, generation: 2, tools }).tools).toHaveLength(1);
    expect(
      mcpToolCatalogProjectionSchema.parse({
        server,
        generation: 2,
        tools,
        rejectedTools: [{ mcpToolName: "unsafe", reason: "forbidden-keyword" }],
        rejectedToolsTruncated: false,
      }),
    ).toMatchObject({ rejectedTools: [{ mcpToolName: "unsafe" }] });
    expect(
      toolStateSourceSchema.parse({ kind: "mcp", server, generation: 2, mcpToolName: "lookup" }),
    ).toMatchObject({ kind: "mcp" });
    for (const type of [
      "webview/mcp-connect",
      "webview/mcp-disconnect",
      "webview/mcp-open-settings",
    ] as const) {
      expect(
        webviewToExtensionMessageSchema.safeParse({ protocolVersion, type, requestId: type })
          .success,
      ).toBe(true);
    }
    expect(
      webviewToExtensionMessageSchema.safeParse({
        protocolVersion,
        type: "webview/mcp-refresh-tools",
        requestId: "refresh",
        serverId: server.serverId,
        generation: 2,
      }).success,
    ).toBe(true);
  });

  it("accepts one strict sequence-bearing catalog envelope", () => {
    const message = {
      protocolVersion,
      type: "extension/mcp-tool-catalog",
      requestId: "catalog",
      catalogSequence: 1,
      catalog: {
        server,
        generation: 2,
        tools,
        rejectedTools: [{ mcpToolName: "unsafe", reason: "schema-invalid" }],
        rejectedToolsTruncated: false,
      },
    } as const;
    expect(mcpToolCatalogMessageSchema.parse(message)).toEqual(message);
    expect(extensionToWebviewMessageSchema.safeParse({ ...message, extra: true }).success).toBe(
      false,
    );
  });

  it("accepts strict diagnostics and rejects illegal recovery combinations", () => {
    const message = {
      protocolVersion,
      type: "extension/mcp-diagnostics" as const,
      requestId: "diagnostic",
      diagnosticSequence: 1,
      diagnostic: {
        kind: "tool-rejections" as const,
        outcome: "degraded" as const,
        server,
        generation: 2,
        connectionStatus: "connected" as const,
        skippedTools: [{ mcpToolName: "unsafe", reason: "schema-invalid" as const }],
        skippedToolsTruncated: false,
        recoveryAction: "refresh-tools" as const,
      },
    };
    expect(mcpDiagnosticsMessageSchema.parse(message)).toEqual(message);
    expect(
      mcpDiagnosticsMessageSchema.safeParse({
        ...message,
        diagnostic: {
          ...message.diagnostic,
          connectionStatus: "failed",
          recoveryAction: "reconnect",
        },
      }).success,
    ).toBe(false);
    expect(extensionToWebviewMessageSchema.safeParse({ ...message, extra: true }).success).toBe(
      false,
    );
  });

  it("rejects loose payloads, stale sequence values, and the retired pair message", () => {
    expect(
      mcpConnectionSchema.safeParse({
        status: "connected",
        server,
        generation: 2,
        configurationStale: false,
        protocolVersion: "2026-07-28",
        capabilities,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/tool-state",
        requestId: "call",
        call: { id: "1", name: "lookup", input: {} },
        status: "pending",
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/mcp-tool-catalog",
        requestId: "catalog",
        catalogSequence: 0,
        catalog: {
          server,
          generation: 2,
          tools,
          rejectedTools: [],
          rejectedToolsTruncated: false,
        },
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/mcp-tool-rejections",
        requestId: "reject",
        catalog: { server, generation: 2, rejectedTools: [], rejectedToolsTruncated: false },
      }).success,
    ).toBe(false);
    expect(
      webviewToExtensionMessageSchema.safeParse({
        protocolVersion,
        type: "webview/mcp-resource-detach",
        requestId: "detach",
        snapshotId: "",
      }).success,
    ).toBe(false);
  });

  it("bounds names and the complete combined envelope by UTF-8 bytes", () => {
    expect(
      mcpToolCatalogMessageSchema.safeParse({
        protocolVersion,
        type: "extension/mcp-tool-catalog",
        requestId: "catalog",
        catalogSequence: 1,
        catalog: {
          server,
          generation: 2,
          tools,
          rejectedTools: [{ mcpToolName: "\ud800", reason: "schema-invalid" }],
          rejectedToolsTruncated: false,
        },
      }).success,
    ).toBe(false);
    expect(
      mcpToolCatalogMessageSchema.safeParse({
        protocolVersion,
        type: "extension/mcp-tool-catalog",
        requestId: "catalog",
        catalogSequence: 1,
        catalog: {
          server,
          generation: 2,
          tools: [],
          rejectedTools: Array.from({ length: 20 }, (_, index) => ({
            mcpToolName: `${index}${"x".repeat(60_000)}`,
            reason: "schema-invalid" as const,
          })),
          rejectedToolsTruncated: true,
        },
      }).success,
    ).toBe(false);

    const base = {
      protocolVersion,
      type: "extension/mcp-tool-catalog" as const,
      requestId: "catalog",
      catalogSequence: 1,
      catalog: {
        server,
        generation: 2,
        tools: [],
        rejectedTools: Array.from({ length: 16 }, (_, index) => ({
          mcpToolName: `${index}${"x".repeat(60_000)}`,
          reason: "schema-invalid" as const,
        })),
        rejectedToolsTruncated: false,
      },
    };
    const remaining = 1_048_576 - utf8Bytes(JSON.stringify(base));
    const perEntry = Math.floor(remaining / base.catalog.rejectedTools.length);
    const remainder = remaining % base.catalog.rejectedTools.length;
    const exact = {
      ...base,
      catalog: {
        ...base.catalog,
        rejectedTools: base.catalog.rejectedTools.map((entry, index) => ({
          ...entry,
          mcpToolName: `${index}${"x".repeat(60_000 + perEntry + (index < remainder ? 1 : 0))}`,
        })),
      },
    };
    expect(utf8Bytes(JSON.stringify(exact))).toBe(1_048_576);
    expect(mcpToolCatalogMessageSchema.safeParse(exact).success).toBe(true);
    const oversized = {
      ...exact,
      catalog: {
        ...exact.catalog,
        rejectedTools: exact.catalog.rejectedTools.map((entry, index) =>
          index === 0 ? { ...entry, mcpToolName: `${entry.mcpToolName}x` } : entry,
        ),
      },
    };
    expect(mcpToolCatalogMessageSchema.safeParse(oversized).success).toBe(false);
  });
});

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
