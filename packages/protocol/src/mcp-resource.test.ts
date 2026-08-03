import { describe, expect, it } from "vitest";

import {
  maxMcpResourceTextCodePoints,
  mcpResourceAttachmentSchema,
  mcpResourceCatalogSchema,
  mcpResourceSnapshotSchema,
} from "./mcp-resource.js";
import {
  extensionToWebviewMessageSchema,
  protocolVersion,
  webviewToExtensionMessageSchema,
} from "./messages.js";

const server = { serverId: "local_fixture", displayName: "Local fixture" } as const;

describe("MCP Resource Protocol", () => {
  it("strictly validates a bounded catalog and unique Template arguments", () => {
    expect(
      mcpResourceCatalogSchema.parse({
        server,
        generation: 3,
        resources: [{ server, generation: 3, uri: "memory://a", name: "A" }],
        templates: [
          {
            server,
            generation: 3,
            uriTemplate: "docs://{section}",
            name: "Docs",
            arguments: [{ name: "section", required: true }],
          },
        ],
      }),
    ).toBeDefined();
    expect(
      mcpResourceCatalogSchema.safeParse({
        server,
        generation: 3,
        resources: [],
        templates: [
          {
            server,
            generation: 3,
            uriTemplate: "docs://{section}",
            name: "Docs",
            arguments: [
              { name: "section", required: true },
              { name: "section", required: true },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates read/attach intents without accepting content from the Webview", () => {
    expect(
      webviewToExtensionMessageSchema.parse({
        protocolVersion,
        type: "webview/mcp-resource-read",
        requestId: "read-1",
        serverId: "local_fixture",
        generation: 3,
        selection: { kind: "resource", uri: "memory://a" },
      }),
    ).toBeDefined();
    expect(
      webviewToExtensionMessageSchema.safeParse({
        protocolVersion,
        type: "webview/mcp-resource-attach",
        requestId: "attach-1",
        serverId: "local_fixture",
        generation: 3,
        snapshotId: "snapshot-1",
        text: "must not cross from the Webview",
      }).success,
    ).toBe(false);
  });

  it("validates ready snapshots and immutable attachments", () => {
    const snapshot = {
      server,
      generation: 3,
      uri: "memory://a",
      mimeType: "text/plain",
      items: [{ text: "ordinary untrusted context" }],
      truncated: false,
    } as const;
    expect(
      extensionToWebviewMessageSchema.parse({
        protocolVersion,
        type: "extension/mcp-resource-preview",
        requestId: "read-1",
        status: "ready",
        snapshotId: "snapshot-1",
        snapshot,
      }),
    ).toBeDefined();
    expect(
      mcpResourceAttachmentSchema.parse({
        snapshotId: "snapshot-1",
        serverId: "local_fixture",
        uri: "memory://a",
        mimeType: "text/plain",
        text: "ordinary untrusted context",
        truncated: false,
      }),
    ).toBeDefined();
  });

  it("rejects invalid Unicode and aggregate text overflow", () => {
    expect(
      mcpResourceSnapshotSchema.safeParse({
        server,
        generation: 3,
        uri: "memory://a",
        mimeType: "text/plain",
        items: [{ text: "\ud800" }],
        truncated: false,
      }).success,
    ).toBe(false);
    expect(
      mcpResourceSnapshotSchema.safeParse({
        server,
        generation: 3,
        uri: "memory://a",
        mimeType: "text/plain",
        items: [{ text: "a".repeat(maxMcpResourceTextCodePoints) }, { text: "b" }],
        truncated: false,
      }).success,
    ).toBe(false);
  });
});
