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
});
