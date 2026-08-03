import { describe, expect, it } from "vitest";

import { maxMcpMessageBytes, maxMcpStderrBytes, mcpProtocolVersion } from "./contracts.js";
import { ControlledMcpClient } from "./controlled-mcp-client.js";
import { FixtureStdioPort, isMethod, jsonRpcId } from "./fixture-stdio-port.js";

describe("ControlledMcpClient", () => {
  it("connects through pinned modern discovery and projects only authorized capabilities", async () => {
    const port = discoveryPort({
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: false },
      logging: {},
      completions: {},
      experimental: { ignored: {} },
    });
    const client = new ControlledMcpClient(port, {
      clientName: "test-client",
      clientVersion: "1.0.0",
    });

    const outcome = await client.connect();

    expect(outcome).toEqual({
      kind: "connected",
      connection: {
        status: "connected",
        protocolVersion: mcpProtocolVersion,
        capabilities: {
          tools: true,
          toolsListChanged: true,
          resources: true,
          resourceTemplates: true,
          resourcesListChanged: true,
          prompts: true,
          promptsListChanged: false,
        },
      },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
    expect(JSON.stringify(port.messages[0])).not.toMatch(
      /initialize|initialized|sampling|elicitation|roots|tasks|experimental/i,
    );

    await expect(client.disconnect()).resolves.toEqual({ kind: "disconnected" });
    await expect(client.dispose()).resolves.toEqual({ kind: "disconnected" });
    expect(port.closeInputCount).toBe(1);
    expect(port.terminateCount).toBe(1);
  });

  it.each([
    ["2025-11-25"],
    ["2027-01-01"],
  ])("rejects incompatible protocol version %s without fallback", async (version) => {
    const client = new ControlledMcpClient(discoveryPort({}, [version]));

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "protocol-incompatible" },
    });
    expect(client.getState()).toMatchObject({
      status: "failed",
      error: { code: "protocol-incompatible" },
    });
  });

  it("classifies malformed stdout and cleans up the port", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitRaw(new TextEncoder().encode("not-json\n"));
      }
    });
    const client = new ControlledMcpClient(port);

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "malformed-message" },
    });
    expect(port.closeInputCount).toBe(1);
    expect(port.terminateCount).toBe(1);
  });

  it("rejects an inbound frame before it exceeds the message limit", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitRaw(new Uint8Array(maxMcpMessageBytes + 1).fill(0x61));
      }
    });
    const client = new ControlledMcpClient(port);

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "limit-exceeded" },
    });
  });

  it("propagates setup cancellation and ignores a late discovery result", async () => {
    const port = new FixtureStdioPort();
    const client = new ControlledMcpClient(port);
    const controller = new AbortController();
    const connection = client.connect(controller.signal);
    const request = await port.waitForMessage(isMethod("server/discover"));

    controller.abort();
    await Promise.resolve();
    expect(port.closeInputCount).toBe(1);
    await expect(connection).resolves.toEqual({ kind: "cancelled" });
    port.emitJson(discoveryResponse(jsonRpcId(request)));

    expect(client.getState()).toEqual({
      status: "disconnected",
      capabilities: emptyCapabilities,
    });
    expect(port.terminateCount).toBe(1);
  });

  it("handles dispose racing with connection setup without duplicate cleanup", async () => {
    const port = new FixtureStdioPort();
    const client = new ControlledMcpClient(port);
    const connection = client.connect();
    await port.waitForMessage(isMethod("server/discover"));

    const disposal = client.dispose();

    await expect(connection).resolves.toEqual({ kind: "cancelled" });
    await expect(disposal).resolves.toEqual({ kind: "disconnected" });
    expect(port.closeInputCount).toBe(1);
    expect(port.terminateCount).toBe(1);
  });

  it("distinguishes an early Server exit from cancellation", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.exit();
      }
    });
    const client = new ControlledMcpClient(port);

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "server-exited" },
    });
  });

  it("keeps termination-unconfirmed distinct during disconnect", async () => {
    const port = discoveryPort({});
    port.termination = "unconfirmed";
    const client = new ControlledMcpClient(port);
    await client.connect();

    await expect(client.disconnect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "termination-unconfirmed" },
    });
    expect(client.getState()).toMatchObject({
      status: "failed",
      error: { code: "termination-unconfirmed" },
    });
  });

  it("retains only the bounded stderr prefix and discards late stderr", async () => {
    const stderr = new Uint8Array(maxMcpStderrBytes + 10).fill(0x61);
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitStderr(stderr);
        fixture.emitJson(discoveryResponse(jsonRpcId(message)));
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();

    expect(client.getStderr()).toEqual({ text: "a".repeat(maxMcpStderrBytes), truncated: true });
    await client.disconnect();
    port.emitStderr(new TextEncoder().encode("late"));
    expect(client.getStderr()).toEqual({ text: "a".repeat(maxMcpStderrBytes), truncated: true });
  });

  it("normalizes startup failures without exposing the Host cause", async () => {
    const port = new FixtureStdioPort();
    port.startFailure = true;
    const client = new ControlledMcpClient(port);

    await expect(client.connect()).resolves.toEqual({
      kind: "failed",
      error: {
        code: "connect-failed",
        message: "Could not connect to the MCP Server.",
      },
    });
  });
});

const emptyCapabilities = {
  tools: false,
  toolsListChanged: false,
  resources: false,
  resourceTemplates: false,
  resourcesListChanged: false,
  prompts: false,
  promptsListChanged: false,
};

function discoveryPort(
  capabilities: Readonly<Record<string, unknown>>,
  supportedVersions: readonly string[] = [mcpProtocolVersion],
): FixtureStdioPort {
  return new FixtureStdioPort((message, port) => {
    if (message.method === "server/discover") {
      port.emitJson(discoveryResponse(jsonRpcId(message), capabilities, supportedVersions));
    }
  });
}

function discoveryResponse(
  id: string | number,
  capabilities: Readonly<Record<string, unknown>> = {},
  supportedVersions: readonly string[] = [mcpProtocolVersion],
): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      supportedVersions,
      capabilities,
    },
  };
}
