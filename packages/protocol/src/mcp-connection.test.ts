import { describe, expect, it } from "vitest";

import {
  mcpConnectionSchema,
  mcpToolCatalogSchema,
  mcpToolRejectionCatalogSchema,
  toolStateSourceSchema,
} from "./mcp-connection.js";
import {
  extensionToWebviewMessageSchema,
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

describe("MCP connection Protocol", () => {
  it("accepts bounded connection, catalog, source, and explicit user intents", () => {
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
    expect(
      mcpToolCatalogSchema.parse({
        server,
        generation: 2,
        tools: [
          {
            server,
            generation: 2,
            registryName: "mcp_local_fixture_lookup",
            mcpToolName: "lookup",
          },
        ],
      }).tools,
    ).toHaveLength(1);
    expect(
      mcpToolRejectionCatalogSchema.parse({
        server,
        generation: 2,
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
  });

  it("rejects loose payloads and requires Tool source identity", () => {
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
      webviewToExtensionMessageSchema.safeParse({
        protocolVersion,
        type: "webview/mcp-resource-detach",
        requestId: "detach",
        snapshotId: "",
      }).success,
    ).toBe(false);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        protocolVersion,
        type: "extension/mcp-tool-rejections",
        requestId: "reject",
        catalog: {
          server,
          generation: 2,
          rejectedTools: [{ mcpToolName: "unsafe", reason: "not-a-reason" }],
          rejectedToolsTruncated: false,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts the additive rejection message with the matching strict envelope", () => {
    const message = {
      protocolVersion,
      type: "extension/mcp-tool-rejections",
      requestId: "catalog",
      catalog: {
        server,
        generation: 2,
        rejectedTools: [{ mcpToolName: "unsafe", reason: "schema-invalid" }],
        rejectedToolsTruncated: false,
      },
    } as const;
    expect(extensionToWebviewMessageSchema.parse(message)).toEqual(message);
    expect(
      extensionToWebviewMessageSchema.safeParse({ ...message, requestId: "catalog", extra: true })
        .success,
    ).toBe(false);
  });

  it("bounds rejection names by well-formed Unicode and serialized projection bytes", () => {
    expect(
      mcpToolRejectionCatalogSchema.safeParse({
        server,
        generation: 2,
        rejectedTools: [{ mcpToolName: "\ud800", reason: "schema-invalid" }],
        rejectedToolsTruncated: false,
      }).success,
    ).toBe(false);
    expect(
      mcpToolRejectionCatalogSchema.safeParse({
        server,
        generation: 2,
        rejectedTools: Array.from({ length: 256 }, (_, index) => ({
          mcpToolName: `${String(index)}${"x".repeat(65_000)}`,
          reason: "schema-invalid" as const,
        })),
        rejectedToolsTruncated: true,
      }).success,
    ).toBe(false);
  });
});
