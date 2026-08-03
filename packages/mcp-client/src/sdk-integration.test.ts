import { Client, SdkErrorCode } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { mcpProtocolVersion } from "./contracts.js";
import { FixtureStdioPort, isMethod, jsonRpcId } from "./fixture-stdio-port.js";
import { controlledSdkClientOptions } from "./sdk-options.js";
import { SdkStdioTransport } from "./sdk-stdio-transport.js";

describe("pinned SDK integration", () => {
  it("pins the exact modern version and disables undeclared Client capabilities", () => {
    expect(controlledSdkClientOptions).toEqual({
      capabilities: {},
      enforceStrictCapabilities: true,
      inputRequired: { autoFulfill: false },
      supportedProtocolVersions: [mcpProtocolVersion],
      versionNegotiation: { mode: { pin: mcpProtocolVersion } },
    });
  });

  it("correlates concurrent discovery requests that complete out of order", async () => {
    const port = discoveryPort({ tools: {} });
    const { client, transport } = await connectSdk(port);

    const first = client.discover();
    const firstRequest = await port.waitForMessage(
      (message) => message.method === "server/discover" && message !== port.messages[0],
    );
    const second = client.discover();
    const secondRequest = await port.waitForMessage(
      (message) =>
        message.method === "server/discover" &&
        message !== port.messages[0] &&
        message !== firstRequest,
    );

    port.emitJson(discoveryResponse(jsonRpcId(secondRequest), { tools: {} }, "second"));
    port.emitJson(discoveryResponse(jsonRpcId(firstRequest), { tools: {} }, "first"));

    await expect(first).resolves.toMatchObject({ instructions: "first" });
    await expect(second).resolves.toMatchObject({ instructions: "second" });
    await client.close();
    await transport.waitForCleanup();
  });

  it("cancels a request, ignores its late result, and keeps correlation usable", async () => {
    const port = discoveryPort({});
    const { client, transport } = await connectSdk(port);
    const controller = new AbortController();
    const cancelled = client.discover({ signal: controller.signal });
    const cancelledRequest = await port.waitForMessage(
      (message) => message.method === "server/discover" && message !== port.messages[0],
    );

    controller.abort();
    await expect(cancelled).rejects.toBeDefined();
    port.emitJson(discoveryResponse(jsonRpcId(cancelledRequest), {}, "late"));

    const next = client.discover();
    const nextRequest = await port.waitForMessage(
      (message) =>
        message.method === "server/discover" &&
        message !== port.messages[0] &&
        message !== cancelledRequest,
    );
    port.emitJson(discoveryResponse(jsonRpcId(nextRequest), {}, "next"));
    await expect(next).resolves.toMatchObject({ instructions: "next" });

    await client.close();
    await transport.waitForCleanup();
  });

  it("rejects an operation whose Server capability was not negotiated", async () => {
    const port = discoveryPort({});
    const { client, transport } = await connectSdk(port);

    await expect(client.callTool({ name: "fixture", arguments: {} })).rejects.toMatchObject({
      code: SdkErrorCode.CapabilityNotSupported,
    });
    expect(port.messages.filter(isMethod("tools/call"))).toHaveLength(0);

    await client.close();
    await transport.waitForCleanup();
  });

  it("surfaces input_required without auto-fulfilment or retry", async () => {
    const port = discoveryPort({ tools: {} });
    const { client, transport } = await connectSdk(port);
    const call = client.callTool({ name: "fixture", arguments: {} });
    const request = await port.waitForMessage(isMethod("tools/call"));

    port.emitJson({
      jsonrpc: "2.0",
      id: jsonRpcId(request),
      result: { resultType: "input_required", requestState: "opaque" },
    });

    await expect(call).rejects.toMatchObject({ code: SdkErrorCode.UnsupportedResultType });
    expect(port.messages.filter(isMethod("tools/call"))).toHaveLength(1);
    await client.close();
    await transport.waitForCleanup();
  });
});

async function connectSdk(
  port: FixtureStdioPort,
): Promise<{ client: Client; transport: SdkStdioTransport }> {
  const transport = new SdkStdioTransport(port, () => {});
  const client = new Client({ name: "fixture", version: "1.0.0" }, controlledSdkClientOptions);
  await client.connect(transport);
  return { client, transport };
}

function discoveryPort(capabilities: Readonly<Record<string, unknown>>): FixtureStdioPort {
  let initial = true;
  return new FixtureStdioPort((message, port) => {
    if (initial && message.method === "server/discover") {
      initial = false;
      port.emitJson(discoveryResponse(jsonRpcId(message), capabilities));
    }
  });
}

function discoveryResponse(
  id: string | number,
  capabilities: Readonly<Record<string, unknown>>,
  instructions?: string,
): Readonly<Record<string, unknown>> {
  const result = {
    resultType: "complete",
    supportedVersions: [mcpProtocolVersion],
    capabilities,
    ...(instructions === undefined ? {} : { instructions }),
  };
  return { jsonrpc: "2.0", id, result };
}
