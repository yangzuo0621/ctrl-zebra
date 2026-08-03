import { type McpPromptCatalogDto, protocolVersion } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { createMcpPromptStore } from "./mcp-prompt-store.js";

const server = { serverId: "local_fixture", displayName: "Local fixture" };
const catalog: McpPromptCatalogDto = {
  server,
  generation: 3,
  prompts: [
    {
      server,
      generation: 3,
      name: "review",
      arguments: [{ name: "code", required: true }],
    },
    { server, generation: 3, name: "explain", arguments: [] },
  ],
};

describe("MCP Prompt store", () => {
  it("supports a keyboard-friendly select, fill, preview, and confirm flow", () => {
    const host = { previewPrompt: vi.fn(), confirmPrompt: vi.fn(), cancelPrompt: vi.fn() };
    const ids = ["preview-request", "confirm-request"];
    const store = createMcpPromptStore(host, () => ids.shift() ?? "unexpected");
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompts",
      requestId: "catalog",
      catalog,
    });
    expect(store.getState().requestPreview()).toBe(false);
    store.getState().setArgument("code", "const x = 1");
    expect(store.getState().requestPreview()).toBe(true);
    expect(host.previewPrompt).toHaveBeenCalledWith(
      "preview-request",
      "local_fixture",
      3,
      "review",
      { code: "const x = 1" },
    );
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompt-preview",
      requestId: "preview-request",
      status: "ready",
      preview: {
        previewId: "preview-1",
        server,
        generation: 3,
        promptName: "review",
        arguments: { code: "const x = 1" },
        messages: [{ sourceRole: "assistant", text: "Ordinary text" }],
      },
    });
    expect(store.getState().confirm()).toBe(true);
    expect(host.confirmPrompt).toHaveBeenCalledWith(
      "confirm-request",
      "local_fixture",
      3,
      "preview-1",
    );
  });

  it("ignores stale responses and clears preview on catalog replacement", () => {
    const host = { previewPrompt: vi.fn(), confirmPrompt: vi.fn(), cancelPrompt: vi.fn() };
    const store = createMcpPromptStore(host, () => "current-request");
    store
      .getState()
      .receive({ protocolVersion, type: "extension/mcp-prompts", requestId: "catalog", catalog });
    store.getState().setArgument("code", "x");
    store.getState().requestPreview();
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompt-preview",
      requestId: "stale-request",
      status: "error",
      code: "prompt-unavailable",
      message: "stale",
    });
    expect(store.getState().status).toBe("previewing");
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompts",
      requestId: "replacement",
      catalog: { ...catalog, prompts: [...catalog.prompts] },
    });
    expect(store.getState()).toMatchObject({ status: "idle", preview: undefined });
  });

  it("cancels the exact ready preview and clears state only on its response", () => {
    const host = { previewPrompt: vi.fn(), confirmPrompt: vi.fn(), cancelPrompt: vi.fn() };
    const ids = ["preview-request", "cancel-request"];
    const store = createMcpPromptStore(host, () => ids.shift() ?? "unexpected");
    store
      .getState()
      .receive({ protocolVersion, type: "extension/mcp-prompts", requestId: "catalog", catalog });
    store.getState().setArgument("code", "x");
    store.getState().requestPreview();
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompt-preview",
      requestId: "preview-request",
      status: "ready",
      preview: {
        previewId: "preview-1",
        server,
        generation: 3,
        promptName: "review",
        arguments: { code: "x" },
        messages: [{ sourceRole: "user", text: "text" }],
      },
    });
    expect(store.getState().cancel()).toBe(true);
    expect(host.cancelPrompt).toHaveBeenCalledWith(
      "cancel-request",
      "local_fixture",
      3,
      "preview-1",
    );
    store.getState().receive({
      protocolVersion,
      type: "extension/mcp-prompt-preview",
      requestId: "cancel-request",
      status: "cancelled",
      previewId: "preview-1",
    });
    expect(store.getState()).toMatchObject({ status: "idle", preview: undefined });
  });
});
