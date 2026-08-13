import { Client, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import {
  type McpProcessTermination,
  mcpLegacyProtocolVersion,
  mcpProtocolVersion,
} from "./contracts.js";
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
    expect(sdk.sdkErrorIsInstance).toBe(true);
    expect(sdk.sdkErrorCode).toBe(SdkErrorCode.EraNegotiationFailed);
  });

  it("compares server exit and SDK cleanup ownership", async () => {
    const serverExit = (message: Readonly<Record<string, unknown>>, port: FixtureStdioPort) => {
      if (message.method === "server/discover") port.exit();
    };

    const controlled = await runControlled(serverExit);
    const sdk = await runSdkAuto(serverExit);

    expect(controlled).toMatchObject({
      kind: "failed",
      errorCode: "server-exited",
      methods: ["server/discover"],
      closeInputCount: 1,
      terminateCount: 1,
    });
    expect(sdk).toMatchObject({
      kind: "rejected",
      methods: ["server/discover"],
      sdkErrorIsInstance: true,
      sdkErrorCode: SdkErrorCode.EraNegotiationFailed,
      closeInputCount: 1,
      terminateCount: 1,
      termination: "terminated",
      lateDeliveryDropped: true,
    });
  });

  it("compares stale-generation disconnect and late delivery", async () => {
    const port = new FixtureStdioPort();
    const controlledClient = new ControlledMcpClient(port, { protocolMode: "dual" });
    const controlled = controlledClient.connect();
    const probe = await port.waitForMessage(isMethod("server/discover"));
    const disconnecting = controlledClient.disconnect();

    port.emitJson(discoveryResponse(jsonRpcId(probe)));
    await expect(controlled).resolves.toEqual({ kind: "cancelled" });
    await expect(disconnecting).resolves.toEqual({ kind: "disconnected" });
    expect(controlledClient.getState()).toMatchObject({ status: "disconnected" });
    expect(port.messages.map((message) => String(message.method))).toEqual(["server/discover"]);
    expect(port.closeInputCount).toBe(1);
    expect(port.terminateCount).toBe(1);

    const sdk = await runSdkAbortAfterProbe();
    expect(sdk).toMatchObject({
      kind: "rejected",
      methods: ["server/discover"],
      sdkErrorIsInstance: true,
      sdkErrorCode: SdkErrorCode.EraNegotiationFailed,
      closeInputCount: 1,
      terminateCount: 1,
      termination: "terminated",
      lateDeliveryDropped: true,
    });
  });

  it("keeps SDK termination confirmation observable during close", async () => {
    const sdk = await runSdkAuto(modernSuccess, false, "unconfirmed");

    expect(sdk).toMatchObject({
      kind: "connected",
      closeInputCount: 1,
      terminateCount: 1,
      termination: "unconfirmed",
      lateDeliveryDropped: true,
    });
  });
});

type Configure = (
  message: Readonly<Record<string, unknown>>,
  port: FixtureStdioPort,
) => void | Promise<void>;

interface RunResult {
  readonly kind: "connected" | "failed" | "cancelled" | "rejected";
  readonly errorCode?: string;
  readonly sdkErrorIsInstance?: boolean;
  readonly sdkErrorCode?: SdkErrorCode;
  readonly methods: readonly string[];
  readonly protocolVersion?: string;
  readonly closeInputCount?: number;
  readonly terminateCount?: number;
  readonly termination?: McpProcessTermination;
  readonly lateDeliveryDropped?: boolean;
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
    closeInputCount: port.closeInputCount,
    terminateCount: port.terminateCount,
    termination: port.termination,
  };
}

async function runSdkAuto(
  configure: Configure = modernSuccess,
  abortBeforeResponse = false,
  termination: McpProcessTermination = "terminated",
): Promise<RunResult> {
  return runSdk(configure, "auto", abortBeforeResponse, termination);
}

async function runSdkPinned(configure: Configure): Promise<RunResult> {
  return runSdk(configure, { pin: mcpProtocolVersion });
}

async function runSdk(
  configure: Configure,
  mode: "auto" | { readonly pin: string },
  abortBeforeResponse = false,
  termination: McpProcessTermination = "terminated",
): Promise<RunResult> {
  const port = new FixtureStdioPort(configure);
  port.termination = termination;
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
    return summarizeSdkRun(port, transport, "connected");
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.waitForCleanup();
    return summarizeSdkRun(port, transport, "rejected", error);
  }
}

async function runSdkAbortAfterProbe(): Promise<RunResult> {
  const port = new FixtureStdioPort();
  const transport = new SdkStdioTransport(port, () => {});
  const client = new Client(
    { name: "eo012-fixture", version: "1.0.0" },
    {
      capabilities: {},
      enforceStrictCapabilities: true,
      inputRequired: { autoFulfill: false },
      supportedProtocolVersions: [mcpProtocolVersion, mcpLegacyProtocolVersion],
      versionNegotiation: { mode: "auto", probe: { timeoutMs: sdkTimeoutMs } },
    },
  );
  const controller = new AbortController();
  const connection = client.connect(transport, {
    signal: controller.signal,
    timeout: sdkTimeoutMs,
  });
  const probe = await port.waitForMessage(isMethod("server/discover"));
  controller.signal.addEventListener(
    "abort",
    () => {
      void transport.close();
    },
    { once: true },
  );
  controller.abort();

  let error: unknown;
  try {
    await connection;
  } catch (caught) {
    error = caught;
  }
  await client.close().catch(() => undefined);
  await transport.waitForCleanup();
  return summarizeSdkRun(port, transport, "rejected", error, jsonRpcId(probe));
}

function summarizeSdkRun(
  port: FixtureStdioPort,
  transport: SdkStdioTransport,
  kind: "connected" | "rejected",
  error?: unknown,
  lateProbeId?: string | number,
): RunResult {
  let lateDelivered = false;
  transport.onmessage = () => {
    lateDelivered = true;
  };
  const probeId = lateProbeId ?? findProbeId(port.messages);
  if (probeId !== undefined) {
    port.emitJson(discoveryResponse(probeId));
  }

  const sdkError = error !== undefined && SdkError.isInstance(error) ? error : undefined;
  return {
    kind,
    sdkErrorIsInstance: error === undefined ? undefined : sdkError !== undefined,
    sdkErrorCode: sdkError?.code,
    methods: port.messages.map((message) => String(message.method)),
    protocolVersion: kind === "connected" ? transport.protocolVersion : undefined,
    closeInputCount: port.closeInputCount,
    terminateCount: port.terminateCount,
    termination: port.termination,
    lateDeliveryDropped: !lateDelivered,
  };
}

function findProbeId(
  messages: readonly Readonly<Record<string, unknown>>[],
): string | number | undefined {
  const probe = messages.find(isMethod("server/discover"));
  return probe === undefined ? undefined : jsonRpcId(probe);
}

const modernSuccess: Configure = (message, port) => {
  if (message.method === "server/discover") {
    port.emitJson(discoveryResponse(jsonRpcId(message)));
  }
};

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
