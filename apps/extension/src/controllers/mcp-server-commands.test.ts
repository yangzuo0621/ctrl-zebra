import { describe, expect, it, vi } from "vitest";

import {
  connectMcpServerCommandId,
  disconnectMcpServerCommandId,
  registerMcpServerCommands,
} from "./mcp-server-commands.js";

describe("MCP Server commands", () => {
  it("registers only explicit connect and disconnect actions and owns both registrations", async () => {
    const handlers = new Map<string, () => Promise<unknown>>();
    const disposals = [vi.fn(), vi.fn()];
    const disconnected = {
      generation: 0,
      status: "disconnected" as const,
      configuredMode: "modern-only" as const,
      configurationStale: false,
    };
    const connect = vi.fn(async () => disconnected);
    const disconnect = vi.fn(async () => disconnected);
    let registration = 0;
    const disposable = registerMcpServerCommands({
      controller: { connect, disconnect },
      registerCommand: (commandId, handler) => {
        handlers.set(commandId, handler);
        return { dispose: disposals[registration++] ?? vi.fn() };
      },
    });

    expect([...handlers.keys()]).toEqual([connectMcpServerCommandId, disconnectMcpServerCommandId]);
    await handlers.get(connectMcpServerCommandId)?.();
    await handlers.get(disconnectMcpServerCommandId)?.();
    expect(connect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();

    disposable.dispose();
    expect(disposals[0]).toHaveBeenCalledOnce();
    expect(disposals[1]).toHaveBeenCalledOnce();
  });
});
