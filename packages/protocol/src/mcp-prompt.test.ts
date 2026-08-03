import { describe, expect, it } from "vitest";

import {
  maxMcpPromptTextCodePoints,
  mcpPromptCatalogSchema,
  mcpPromptConfirmationSchema,
  mcpPromptPreviewSchema,
} from "./mcp-prompt.js";
import { extensionToWebviewMessageSchema, webviewToExtensionMessageSchema } from "./messages.js";

const server = { serverId: "local_fixture", displayName: "Local fixture" };

describe("MCP Prompt Protocol", () => {
  it("strictly validates catalogs and unique bounded arguments", () => {
    expect(
      mcpPromptCatalogSchema.parse({
        server,
        generation: 2,
        prompts: [
          { server, generation: 2, name: "review", arguments: [{ name: "code", required: true }] },
        ],
      }).prompts,
    ).toHaveLength(1);
    expect(
      mcpPromptCatalogSchema.safeParse({
        server,
        generation: 2,
        prompts: [
          {
            server,
            generation: 2,
            name: "bad",
            arguments: [
              { name: "x", required: true },
              { name: "x", required: false },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates preview, confirm, cancel, and state messages", () => {
    const envelope = { protocolVersion: 1, requestId: "req" } as const;
    expect(
      webviewToExtensionMessageSchema.safeParse({
        ...envelope,
        type: "webview/mcp-prompt-preview",
        serverId: "local_fixture",
        generation: 2,
        promptName: "review",
        arguments: { code: "x" },
      }).success,
    ).toBe(true);
    expect(
      webviewToExtensionMessageSchema.safeParse({
        ...envelope,
        type: "webview/mcp-prompt-confirm",
        serverId: "local_fixture",
        generation: 2,
        previewId: "preview-1",
      }).success,
    ).toBe(true);
    expect(
      extensionToWebviewMessageSchema.safeParse({
        ...envelope,
        type: "extension/mcp-prompt-preview",
        status: "cancelled",
        previewId: "preview-1",
      }).success,
    ).toBe(true);
  });

  it("bounds complete preview text without truncation", () => {
    const base = {
      previewId: "preview-1",
      server,
      generation: 2,
      promptName: "review",
      arguments: {},
    };
    expect(
      mcpPromptPreviewSchema.safeParse({
        ...base,
        messages: [{ sourceRole: "user", text: "x".repeat(maxMcpPromptTextCodePoints) }],
      }).success,
    ).toBe(true);
    expect(
      mcpPromptPreviewSchema.safeParse({
        ...base,
        messages: [{ sourceRole: "user", text: "x".repeat(maxMcpPromptTextCodePoints + 1) }],
      }).success,
    ).toBe(false);
  });

  it("keeps confirmation as one strict ordinary projected text value", () => {
    expect(
      mcpPromptConfirmationSchema.parse({
        serverId: "local_fixture",
        promptName: "review",
        projectedText: "ordinary untrusted prompt text",
      }),
    ).toEqual({
      serverId: "local_fixture",
      promptName: "review",
      projectedText: "ordinary untrusted prompt text",
    });
    expect(
      mcpPromptConfirmationSchema.safeParse({
        serverId: "local_fixture",
        promptName: "review",
        projectedText: "x",
        executable: true,
      }).success,
    ).toBe(false);
  });
});
