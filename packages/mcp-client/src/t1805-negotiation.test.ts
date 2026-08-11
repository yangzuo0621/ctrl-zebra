import { describe, expect, it } from "vitest";

import { mcpLegacyProtocolVersion, mcpProtocolVersion } from "./contracts.js";
import { ControlledMcpClient } from "./controlled-mcp-client.js";
import { FixtureStdioPort, isMethod, jsonRpcId } from "./fixture-stdio-port.js";

describe("T1805 modern-first stdio negotiation", () => {
  it("keeps a dual modern connection on one discover probe", async () => {
    const port = modernPort();
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "connected",
      connection: {
        configuredMode: "dual",
        negotiated: { era: "modern", version: mcpProtocolVersion },
      },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
    await client.disconnect();
  });

  it("accepts the bounded cache metadata carried by a modern DiscoverResult", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        const id = jsonRpcId(message);
        fixture.emitJson({
          jsonrpc: "2.0",
          id,
          result: { ...discoveryResult(), ttlMs: 0, cacheScope: "private" },
        });
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({ kind: "connected" });
    await client.disconnect();
  });

  it("selects modern after a recognized error and one corrective discover", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method !== "server/discover") return;
      if (port.messages.filter(isMethod("server/discover")).length === 1) {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          error: {
            code: -32_022,
            message: "Unsupported protocol version",
            data: { supported: [mcpProtocolVersion], requested: mcpProtocolVersion },
          },
        });
        return;
      }
      fixture.emitJson(discoveryResponse(jsonRpcId(message)));
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "connected",
      connection: { negotiated: { era: "modern", version: mcpProtocolVersion } },
    });
    expect(port.messages.filter(isMethod("server/discover"))).toHaveLength(2);
    expect(port.messages.some(isMethod("initialize"))).toBe(false);
    await client.disconnect();
  });

  it.each([
    ["unsupported modern version", { supported: [mcpLegacyProtocolVersion] }],
    ["unknown future version", { supported: ["2027-01-01"] }],
  ])("does not fallback for a recognized modern error: %s", async (_label, data) => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          error: {
            code: -32_022,
            message: "Unsupported protocol version",
            data: { ...data, requested: mcpProtocolVersion },
          },
        });
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "protocol-incompatible" },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
  });

  it.each([
    -32_700, -32_600, -32_601, -32_602, -32_603,
  ])("falls back once after the defined non-modern JSON-RPC error %s", async (probeErrorCode) => {
    const port = legacyPort({ probeErrorCode });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "connected",
      connection: {
        protocolVersion: mcpLegacyProtocolVersion,
        negotiated: { era: "legacy", version: mcpLegacyProtocolVersion },
      },
    });
    expect(port.messages.map((message) => message.method)).toEqual([
      "server/discover",
      "initialize",
      "notifications/initialized",
    ]);
    await client.disconnect();
  });

  it("does not downgrade for an unknown implementation-defined error code", async () => {
    const port = legacyPort({ probeErrorCode: -32_000 });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "protocol-incompatible" },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
  });

  it("falls back once after a bounded probe timeout", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "initialize") {
        fixture.emitJson(initializeResponse(jsonRpcId(message)));
      }
    });
    const client = new ControlledMcpClient(port, {
      protocolMode: "dual",
      probeTimeoutMs: 5,
    });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "connected",
      connection: { negotiated: { era: "legacy" } },
    });
    expect(port.messages.map((message) => message.method)).toEqual([
      "server/discover",
      "initialize",
      "notifications/initialized",
    ]);
    await client.disconnect();
  });

  it.each([
    ["shape-invalid result", { resultType: "complete", supportedVersions: [mcpProtocolVersion] }],
    [
      "unknown future result",
      { resultType: "future", supportedVersions: ["2027-01-01"], capabilities: {} },
    ],
  ])("maps %s without fallback", async (_label, result) => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({ jsonrpc: "2.0", id: jsonRpcId(message), result });
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: {
        code: _label === "shape-invalid result" ? "malformed-message" : "protocol-incompatible",
      },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
  });

  it.each([
    ["missing result type", { supportedVersions: [mcpProtocolVersion], capabilities: {} }],
    [
      "invalid capability shape",
      {
        resultType: "complete",
        supportedVersions: [mcpProtocolVersion],
        capabilities: { tools: { listChanged: "yes" } },
      },
    ],
  ])("maps %s as malformed without fallback", async (_label, result) => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({ jsonrpc: "2.0", id: jsonRpcId(message), result });
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "malformed-message" },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
  });

  it("maps a malformed recognized-modern error without fallback", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          error: {
            code: -32_022,
            message: "Unsupported protocol version",
            data: { supported: mcpProtocolVersion },
          },
        });
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "malformed-message" },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
  });

  it("maps a response with a missing correlation id as malformed", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({
          jsonrpc: "2.0",
          error: { code: -32_601, message: "Method not found" },
        });
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "malformed-message" },
    });
    expect(port.messages.map((message) => message.method)).toEqual(["server/discover"]);
  });

  it("maps a malformed legacy initialize result without a second lifecycle", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          error: { code: -32_601, message: "Method not found" },
        });
      } else if (message.method === "initialize") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          result: { protocolVersion: mcpLegacyProtocolVersion, capabilities: {} },
        });
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "malformed-message" },
    });
    expect(port.messages.map((message) => message.method)).toEqual([
      "server/discover",
      "initialize",
    ]);
  });

  it("rejects an unsupported legacy initialize version without retry", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          error: { code: -32_601, message: "Method not found" },
        });
      } else if (message.method === "initialize") {
        fixture.emitJson(initializeResponse(jsonRpcId(message), "2027-01-01"));
      }
    });
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });

    await expect(client.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "protocol-incompatible" },
    });
    expect(port.messages.map((message) => message.method)).toEqual([
      "server/discover",
      "initialize",
    ]);
  });

  it("does not downgrade modern-only or after cancellation", async () => {
    const modernOnly = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson(discoveryResponse(jsonRpcId(message), [mcpLegacyProtocolVersion]));
      }
    });
    const strictClient = new ControlledMcpClient(modernOnly);
    await expect(strictClient.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "protocol-incompatible" },
    });
    expect(modernOnly.messages.some(isMethod("initialize"))).toBe(false);

    const port = new FixtureStdioPort();
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });
    const controller = new AbortController();
    const connection = client.connect(controller.signal);
    const probe = await port.waitForMessage(isMethod("server/discover"));
    controller.abort();
    await expect(connection).resolves.toEqual({ kind: "cancelled" });
    port.emitJson(discoveryResponse(jsonRpcId(probe)));
    expect(port.messages.some(isMethod("initialize"))).toBe(false);
    expect(port.terminateCount).toBe(1);
  });

  it("keeps a process exit terminal and shares duplicate connect callers", async () => {
    const exitPort = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") fixture.exit();
    });
    const exitedClient = new ControlledMcpClient(exitPort, { protocolMode: "dual" });
    await expect(exitedClient.connect()).resolves.toMatchObject({
      kind: "failed",
      error: { code: "server-exited" },
    });
    expect(exitPort.messages.some(isMethod("initialize"))).toBe(false);

    const port = modernPort();
    const client = new ControlledMcpClient(port, { protocolMode: "dual" });
    const first = client.connect();
    const second = client.connect();
    await expect(first).resolves.toMatchObject({ kind: "connected" });
    await expect(second).resolves.toMatchObject({ kind: "connected" });
    expect(port.messages.filter(isMethod("server/discover"))).toHaveLength(1);
    await client.disconnect();
  });
});

function modernPort(): FixtureStdioPort {
  return new FixtureStdioPort((message, fixture) => {
    if (message.method === "server/discover") {
      fixture.emitJson(discoveryResponse(jsonRpcId(message)));
    }
  });
}

function legacyPort(options: { readonly probeErrorCode: number }): FixtureStdioPort {
  return new FixtureStdioPort((message, fixture) => {
    if (message.method === "server/discover") {
      fixture.emitJson({
        jsonrpc: "2.0",
        id: jsonRpcId(message),
        error: { code: options.probeErrorCode, message: "Method not found" },
      });
    } else if (message.method === "initialize") {
      fixture.emitJson(initializeResponse(jsonRpcId(message)));
    }
  });
}

function discoveryResponse(
  id: string | number,
  supportedVersions: readonly string[] = [mcpProtocolVersion],
): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id,
    result: discoveryResult(supportedVersions),
  };
}

function discoveryResult(
  supportedVersions: readonly string[] = [mcpProtocolVersion],
): Readonly<Record<string, unknown>> {
  return { resultType: "complete", supportedVersions, capabilities: {} };
}

function initializeResponse(
  id: string | number,
  protocolVersion: string = mcpLegacyProtocolVersion,
): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion,
      capabilities: {},
      serverInfo: { name: "fixture", version: "1.0.0" },
    },
  };
}
