import { McpResourceError } from "@ctrl-zebra/mcp-client";
import { describe, expect, it, vi } from "vitest";

import { McpResourceActions } from "./mcp-resource-actions.js";

const connected = {
  generation: 2,
  status: "connected",
  server: { serverId: "local_fixture", displayName: "Local fixture" },
  configurationStale: false,
} as const;
const snapshot = {
  server: connected.server,
  generation: 2,
  uri: "memory://note",
  mimeType: "text/plain",
  items: [{ text: "ordinary" }, { text: " context" }],
  truncated: false,
} as const;

describe("MCP Resource actions", () => {
  it("requires separate read and attach actions and consumes the Host snapshot", async () => {
    const connection = {
      getState: vi.fn(() => connected),
      readResource: vi.fn(async () => snapshot),
    };
    const actions = new McpResourceActions({ connection, createId: () => "snapshot-1" });

    const preview = await actions.read("local_fixture", 2, {
      kind: "resource",
      uri: "memory://note",
    });
    expect(actions.takeAttachments()).toEqual([]);
    expect(actions.attach("local_fixture", 2, preview.snapshotId)).toEqual({
      snapshotId: "snapshot-1",
      serverId: "local_fixture",
      uri: "memory://note",
      mimeType: "text/plain",
      text: "ordinary context",
      truncated: false,
    });
    expect(actions.takeAttachments()).toHaveLength(1);
    expect(actions.takeAttachments()).toEqual([]);
  });

  it("rejects attachment after disconnect without mutating the draft", async () => {
    let state:
      | ReturnType<typeof createConnectedState>
      | { status: "disconnected"; generation: number; configurationStale: false } =
      createConnectedState();
    const actions = new McpResourceActions({
      connection: {
        getState: () => state,
        readResource: async () => snapshot,
      },
      createId: () => "snapshot-1",
    });
    await actions.read("local_fixture", 2, { kind: "resource", uri: "memory://note" });
    state = { status: "disconnected", generation: 2, configurationStale: false };

    expect(() => actions.attach("local_fixture", 2, "snapshot-1")).toThrow(McpResourceError);
    expect(actions.takeAttachments()).toEqual([]);
  });

  it("clears previews and unconsumed attachments when the draft is reset", async () => {
    const actions = new McpResourceActions({
      connection: {
        getState: () => connected,
        readResource: async () => snapshot,
      },
      createId: () => "snapshot-1",
    });

    const preview = await actions.read("local_fixture", 2, {
      kind: "resource",
      uri: "memory://note",
    });
    actions.attach("local_fixture", 2, preview.snapshotId);
    actions.clearInput();

    expect(actions.takeAttachments()).toEqual([]);
    expect(() => actions.attach("local_fixture", 2, preview.snapshotId)).toThrow(McpResourceError);
  });

  it("cancels reads on disposal and retains no late preview", async () => {
    let resolveRead: ((value: typeof snapshot) => void) | undefined;
    const actions = new McpResourceActions({
      connection: {
        getState: () => connected,
        readResource: (_serverId, _generation, _selection, signal) =>
          new Promise((resolve, reject) => {
            resolveRead = resolve;
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      },
      createId: () => "late",
    });
    const read = actions.read("local_fixture", 2, { kind: "resource", uri: "memory://note" });
    actions.dispose();

    await expect(read).rejects.toBeDefined();
    resolveRead?.(snapshot);
    expect(actions.takeAttachments()).toEqual([]);
  });
});

function createConnectedState() {
  return { ...connected };
}
