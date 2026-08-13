import { Client } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { mcpLegacyProtocolVersion, mcpProtocolVersion } from "./contracts.js";
import { ControlledMcpClient } from "./controlled-mcp-client.js";
import { FixtureStdioPort, isMethod, jsonRpcId } from "./fixture-stdio-port.js";
import { SdkStdioTransport } from "./sdk-stdio-transport.js";

const sdkTimeoutMs = 25;

describe("EO-012 SDK-native negotiation differential corpus", () => {
  it("compares modern success, eligible legacy error, and timeout", async () => {
    const cases = [
      {
        name: "modern-success",
        configure: (message: Readonly<Record<string, unknown>>, port: FixtureStdioPort) => {
          if (message.method === "server/discover") {
            port.emitJson(discoveryResponse(jsonRpcId(message)));
          }
        },
      },
      {
        name: "defined-legacy-error",
        configure: (message: Readonly<Record<string, unknown>>, port: FixtureStdioPort) => {
          if (message.method === "server/discover") {
            port.emitJson({
              jsonrpc: "2.0",
              id: jsonRpcId(message),
              error: { code: -32_601, message: "Method not found" },
            });
          } else if (message.method === "initialize") {
            port.emitJson(initializeResponse(jsonRpcId(message)));
          }
        },
      },
    ] as const;

    for (const testCase of cases) {
      const controlled = await runControlled(testCase.configure);
      const sdk = await runSdkAuto(testCase.configure);

      expect(sdk.kind, testCase.name).toBe(controlled.kind);
      expect(sdk.methods, testCase.name).toEqual(controlled.methods);
      expect(sdk.protocolVersion, testCase.name).toBe(controlled.protocolVersion);
    }

    const timeout = (message: Readonly<Record<string, unknown>>, port: FixtureStdioPort): void => {
      if (message.method === "initialize") port.emitJson(initializeResponse(jsonRpcId(message)));
    };
    const controlledTimeout = await runControlled(timeout);
    const sdkTimeout = await runSdkAuto(timeout);
    expect(controlledTimeout).toMatchObject({
      kind: "connected",
      protocolVersion: mcpLegacyProtocolVersion,
      methods: ["server/discover", "initialize", "notifications/initialized"],
    });
    expect(sdkTimeout).toMatchObject({ kind: "rejected", methods: ["server/discover"] });
  });

  it("widens dual fallback for unknown and malformed probe outcomes", async () => {
    const cases = [
      {
        name: "unknown-json-rpc-error",
        configure: (message: Readonly<Record<string, unknown>>, port: FixtureStdioPort) => {
          if (message.method === "server/discover") {
            port.emitJson({
              jsonrpc: "2.0",
              id: jsonRpcId(message),
              error: { code: -32_000, message: "implementation-defined" },
            });
          } else if (message.method === "initialize") {
            port.emitJson(initializeResponse(jsonRpcId(message)));
          }
        },
      },
      {
        name: "malformed-discover-result",
        configure: (message: Readonly<Record<string, unknown>>, port: FixtureStdioPort) => {
          if (message.method === "server/discover") {
            port.emitJson({
              jsonrpc: "2.0",
              id: jsonRpcId(message),
              result: { resultType: "complete", supportedVersions: [mcpProtocolVersion] },
            });
          } else if (message.method === "initialize") {
            port.emitJson(initializeResponse(jsonRpcId(message)));
          }
        },
      },
      {
        name: "recognized-modern-error-without-modern-overlap",
        configure: (message: Readonly<Record<string, unknown>>, port: FixtureStdioPort) => {
          if (message.method === "server/discover") {
            port.emitJson({
              jsonrpc: "2.0",
              id: jsonRpcId(message),
              error: {
                code: -32_022,
                message: "Unsupported protocol version",
                data: { supported: [mcpLegacyProtocolVersion], requested: mcpProtocolVersion },
              },
            });
          } else if (message.method === "initialize") {
            port.emitJson(initializeResponse(jsonRpcId(message)));
          }
        },
      },
    ] as const;

    for (const testCase of cases) {
      const controlled = await runControlled(testCase.configure);
      const sdk = await runSdkAuto(testCase.configure);

      expect(controlled.kind, testCase.name).toBe("failed");
      expect(controlled.errorCode, testCase.name).toBe(
        testCase.name === "malformed-discover-result"
          ? "malformed-message"
          : "protocol-incompatible",
      );
      expect(controlled.methods, testCase.name).toEqual(["server/discover"]);
      expect(sdk.kind, testCase.name).toBe("connected");
      expect(sdk.protocolVersion, testCase.name).toBe(mcpLegacyProtocolVersion);
      expect(sdk.methods, testCase.name).toEqual([
        "server/discover",
        "initialize",
        "notifications/initialized",
      ]);
    }
  });

  it("cannot preserve strict malformed classification in modern-only pin mode", async () => {
    const configure = (
      message: Readonly<Record<string, unknown>>,
      port: FixtureStdioPort,
    ): void => {
      if (message.method === "server/discover") {
        port.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          result: { resultType: "complete", supportedVersions: [mcpProtocolVersion] },
        });
      }
    };

    const controlled = await runControlled(configure);
    const sdk = await runSdkPinned(configure);

    expect(controlled).toMatchObject({ kind: "failed", errorCode: "malformed-message" });
    expect(sdk.kind).toBe("rejected");
    expect(sdk.errorName).toBe("SdkError");
  });

  it("keeps generation and cancellation ownership outside SDK negotiation", async () => {
    const port = new FixtureStdioPort();
    const controlledClient = new ControlledMcpClient(port, { protocolMode: "dual" });
    const controller = new AbortController();
    const controlled = controlledClient.connect(controller.signal);
    await port.waitForMessage(isMethod("server/discover"));
    controller.abort();

    await expect(controlled).resolves.toEqual({ kind: "cancelled" });
    expect(port.terminateCount).toBe(1);

    const sdk = await runSdkAuto(() => undefined, true);
    expect(sdk.kind).toBe("rejected");
    expect(sdk.methods).toEqual(["server/discover"]);
  });
});

type Configure = (
  message: Readonly<Record<string, unknown>>,
  port: FixtureStdioPort,
) => void | Promise<void>;

interface RunResult {
  readonly kind: "connected" | "failed" | "cancelled" | "rejected";
  readonly errorCode?: string;
  readonly errorName?: string;
  readonly methods: readonly string[];
  readonly protocolVersion?: string;
}

async function runControlled(configure: Configure): Promise<RunResult> {
  const port = new FixtureStdioPort(configure);
  const client = new ControlledMcpClient(port, {
    protocolMode: "dual",
    probeTimeoutMs: sdkTimeoutMs,
  });
  const outcome = await client.connect();
  await client.disconnect();
  return {
    kind: outcome.kind,
    errorCode: outcome.kind === "failed" ? outcome.error.code : undefined,
    methods: port.messages.map((message) => String(message.method)),
    protocolVersion: outcome.kind === "connected" ? outcome.connection.protocolVersion : undefined,
  };
}

async function runSdkAuto(configure: Configure, abortBeforeResponse = false): Promise<RunResult> {
  return runSdk(configure, "auto", abortBeforeResponse);
}

async function runSdkPinned(configure: Configure): Promise<RunResult> {
  return runSdk(configure, { pin: mcpProtocolVersion });
}

async function runSdk(
  configure: Configure,
  mode: "auto" | { readonly pin: string },
  abortBeforeResponse = false,
): Promise<RunResult> {
  const port = new FixtureStdioPort(configure);
  const transport = new SdkStdioTransport(port, () => {});
  const client = new Client(
    { name: "eo012-fixture", version: "1.0.0" },
    {
      capabilities: {},
      enforceStrictCapabilities: true,
      inputRequired: { autoFulfill: false },
      supportedProtocolVersions: [mcpProtocolVersion, mcpLegacyProtocolVersion],
      versionNegotiation: { mode, probe: { timeoutMs: sdkTimeoutMs } },
    },
  );
  const controller = new AbortController();
  const connection = client.connect(transport, {
    signal: controller.signal,
    timeout: sdkTimeoutMs,
  });
  if (abortBeforeResponse) {
    controller.abort();
  }

  try {
    await connection;
    await client.close();
    await transport.waitForCleanup();
    return {
      kind: "connected",
      methods: port.messages.map((message) => String(message.method)),
      protocolVersion: transport.protocolVersion,
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.waitForCleanup();
    return {
      kind: "rejected",
      errorName: error instanceof Error ? error.name : typeof error,
      methods: port.messages.map((message) => String(message.method)),
    };
  }
}

function discoveryResponse(id: string | number): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id,
    result: { resultType: "complete", supportedVersions: [mcpProtocolVersion], capabilities: {} },
  };
}

function initializeResponse(id: string | number): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: mcpLegacyProtocolVersion,
      capabilities: {},
      serverInfo: { name: "eo012-fixture", version: "1.0.0" },
    },
  };
}
