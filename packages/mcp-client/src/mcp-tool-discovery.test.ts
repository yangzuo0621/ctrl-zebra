import { describe, expect, it } from "vitest";

import { mcpProtocolVersion } from "./contracts.js";
import { ControlledMcpClient } from "./controlled-mcp-client.js";
import { FixtureStdioPort, isMethod, jsonRpcId } from "./fixture-stdio-port.js";
import { McpToolUnavailableError } from "./mcp-tool-snapshot.js";

const context = {
  server: { serverId: "local_fixture", displayName: "Local fixture" },
  generation: 3,
} as const;

describe("ControlledMcpClient Tool discovery", () => {
  it("publishes an empty atomic snapshot when a Tool-capable Server has no Tools", async () => {
    const client = new ControlledMcpClient(toolServer(() => toolPage([])));
    await client.connect();

    await expect(client.discoverTools(context)).resolves.toMatchObject({ tools: [] });
    await client.disconnect();
  });

  it("collects all pages explicitly and publishes one complete generation-bound snapshot", async () => {
    const port = toolServer((message) => {
      const cursor = readParams(message).cursor;
      return cursor === undefined
        ? toolPage([{ name: "first", inputSchema: emptySchema }], "next")
        : toolPage([{ name: "second", inputSchema: emptySchema }]);
    });
    const client = new ControlledMcpClient(port);
    await client.connect();

    const snapshot = await client.discoverTools(context);

    expect(snapshot.tools.map((tool) => tool.mcpToolName)).toEqual(["first", "second"]);
    expect(snapshot.generation).toBe(3);
    expect(
      port.messages.filter(isMethod("tools/list")).map((message) => readParams(message).cursor),
    ).toEqual([undefined, "next"]);
    await client.disconnect();
  });

  it("keeps accepted Tools when a sibling schema is rejected", async () => {
    const client = new ControlledMcpClient(
      toolServer(() =>
        toolPage([
          { name: "valid", inputSchema: emptySchema },
          { name: "unsafe", inputSchema: { type: "object", pattern: "(a+)+$" } },
        ]),
      ),
    );
    await client.connect();

    const snapshot = await client.discoverTools(context);

    expect(snapshot.tools.map((tool) => tool.mcpToolName)).toEqual(["valid"]);
    expect(snapshot.rejectedTools).toEqual([
      { mcpToolName: "unsafe", reason: "forbidden-keyword" },
    ]);
    expect(snapshot.rejectedToolsTruncated).toBe(false);
    await client.disconnect();
  });

  it("keeps the rejection prefix stable when pagination order changes", async () => {
    const rejected = Array.from({ length: 300 }, (_, index) => ({
      name: `rejected-${String(index).padStart(3, "0")}`,
      inputSchema: { type: "object", pattern: "(a+)+$" },
    }));
    const ordered = [
      ...rejected.slice(0, 150),
      ...rejected.slice(150),
      { name: "accepted", inputSchema: emptySchema },
    ];
    const reversedPages = [
      ...rejected.slice(150).reverse(),
      ...rejected.slice(0, 150).reverse(),
      { name: "accepted", inputSchema: emptySchema },
    ];
    const first = new ControlledMcpClient(
      toolServer((message) =>
        readParams(message).cursor === undefined
          ? toolPage(ordered.slice(0, 151), "next")
          : toolPage(ordered.slice(151)),
      ),
    );
    const second = new ControlledMcpClient(
      toolServer((message) =>
        readParams(message).cursor === undefined
          ? toolPage(reversedPages.slice(0, 151), "next")
          : toolPage(reversedPages.slice(151)),
      ),
    );
    await first.connect();
    await second.connect();

    const firstSnapshot = await first.discoverTools(context);
    const secondSnapshot = await second.discoverTools(context);

    expect(firstSnapshot.rejectedTools).toEqual(secondSnapshot.rejectedTools);
    expect(firstSnapshot.rejectedTools.map(({ mcpToolName }) => mcpToolName)).toEqual(
      rejected.slice(0, 256).map(({ name }) => name),
    );
    await first.disconnect();
    await second.disconnect();
  });

  it("fails an all-rejected list and retains the last complete snapshot on refresh failure", async () => {
    let allRejected = false;
    const client = new ControlledMcpClient(
      toolServer(() =>
        allRejected
          ? toolPage([{ name: "unsafe", inputSchema: { type: "object", pattern: "(a+)+$" } }])
          : toolPage([{ name: "stable", inputSchema: emptySchema }]),
      ),
    );
    await client.connect();

    const stable = await client.discoverTools(context);
    allRejected = true;

    await expect(client.discoverTools(context)).rejects.toMatchObject({ code: "invalid-schema" });
    expect(client.getToolSnapshot()).toBe(stable);
    expect(client.getToolDiagnostic()).toEqual({
      kind: "rejections",
      rejectedTools: [{ mcpToolName: "unsafe", reason: "forbidden-keyword" }],
      rejectedToolsTruncated: false,
    });
    await client.disconnect();
  });

  it("rejects a duplicate cursor without replacing the previous complete snapshot", async () => {
    let malformed = false;
    const port = toolServer((_message) => {
      if (!malformed) {
        return toolPage([{ name: "stable", inputSchema: emptySchema }]);
      }
      return toolPage([{ name: "partial", inputSchema: emptySchema }], "repeat");
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    const stable = await client.discoverTools(context);
    malformed = true;

    await expect(client.discoverTools(context)).rejects.toMatchObject({
      code: "malformed-message",
    });
    expect(client.getToolSnapshot()).toBe(stable);
    await client.disconnect();
  });

  it("rejects Tool-count overflow before constructing a snapshot", async () => {
    const tools = Array.from({ length: 1_001 }, (_, index) => ({
      name: `tool_${index}`,
      inputSchema: emptySchema,
    }));
    const client = new ControlledMcpClient(toolServer(() => toolPage(tools)));
    await client.connect();

    await expect(client.discoverTools(context)).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(client.getToolSnapshot()).toBeUndefined();
    await client.disconnect();
  });

  it("rejects pagination that still has a cursor at the page limit", async () => {
    let page = 0;
    const client = new ControlledMcpClient(
      toolServer(() => {
        page += 1;
        return toolPage([], `page_${page}`);
      }),
    );
    await client.connect();

    await expect(client.discoverTools(context)).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(page).toBe(100);
    expect(client.getToolSnapshot()).toBeUndefined();
    await client.disconnect();
  });

  it("coalesces racing list-changed notifications into serialized full refreshes", async () => {
    const heldRequests: Readonly<Record<string, unknown>>[] = [];
    let listRequests = 0;
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson(discoveryResult(message));
      }
      if (message.method === "tools/list") {
        listRequests += 1;
        if (listRequests === 1) {
          fixture.emitJson(toolResponse(message, [{ name: "first", inputSchema: emptySchema }]));
        } else {
          heldRequests.push(message);
        }
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    const first = await client.discoverTools(context);
    const firstTool = first.registry.get(first.tools[0]?.registryName ?? "missing");

    port.emitJson({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    await waitFor(() => heldRequests.length === 1);
    port.emitJson({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    const secondRequest = heldRequests[0];
    if (secondRequest === undefined) {
      throw new Error("Expected the first refresh request.");
    }
    port.emitJson(toolResponse(secondRequest, [{ name: "second", inputSchema: emptySchema }]));
    await waitFor(() => heldRequests.length === 2);
    const thirdRequest = heldRequests[1];
    if (thirdRequest === undefined) {
      throw new Error("Expected the coalesced refresh request.");
    }
    port.emitJson(toolResponse(thirdRequest, [{ name: "third", inputSchema: emptySchema }]));
    await waitFor(() => client.getToolSnapshot()?.tools[0]?.mcpToolName === "third");

    expect(listRequests).toBe(3);
    expect(client.getToolSnapshot()?.tools.map((tool) => tool.mcpToolName)).toEqual(["third"]);
    expect(() => firstTool?.parseInput({})).toThrow();
    await client.disconnect();
  });

  it("does not publish a snapshot after explicit discovery cancellation", async () => {
    const port = toolServer(() => undefined);
    const client = new ControlledMcpClient(port);
    await client.connect();
    const controller = new AbortController();
    const discovery = client.discoverTools(context, controller.signal);
    const request = await port.waitForMessage(isMethod("tools/list"));

    controller.abort();
    await expect(discovery).rejects.toBeDefined();
    port.emitJson({ jsonrpc: "2.0", id: jsonRpcId(request), result: toolPage([]) });

    expect(client.getToolSnapshot()).toBeUndefined();
    await client.disconnect();
  });

  it("cancels an in-flight refresh on disconnect and ignores its late response", async () => {
    let holdRefresh = false;
    const port = toolServer((_message) => {
      if (holdRefresh) {
        return undefined;
      }
      return toolPage([{ name: "stable", inputSchema: emptySchema }]);
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    await client.discoverTools(context);
    holdRefresh = true;
    port.emitJson({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    const request = await port.waitForMessage(
      (message) =>
        message.method === "tools/list" && port.messages.filter(isMethod("tools/list")).length >= 2,
    );

    await client.disconnect();
    port.emitJson({ jsonrpc: "2.0", id: jsonRpcId(request), result: toolPage([]) });

    expect(client.getToolSnapshot()).toBeUndefined();
  });

  it("revokes an old Tool registry after disconnect", async () => {
    const client = new ControlledMcpClient(
      toolServer(() => toolPage([{ name: "stale", inputSchema: emptySchema }])),
    );
    await client.connect();
    const snapshot = await client.discoverTools(context);
    const descriptor = snapshot.tools[0];
    const tool =
      descriptor === undefined ? undefined : snapshot.registry.get(descriptor.registryName);

    await client.disconnect();

    expect(() => tool?.parseInput({})).toThrow(McpToolUnavailableError);
    if (tool?.prepareApproval === undefined) throw new Error("Expected Tool approval preparation.");
    await expect(
      tool.prepareApproval({}, { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(McpToolUnavailableError);
  });

  it("revokes an old Tool registry when its discovery context changes", async () => {
    const client = new ControlledMcpClient(
      toolServer(() => toolPage([{ name: "stale", inputSchema: emptySchema }])),
    );
    await client.connect();
    const first = await client.discoverTools(context);
    const descriptor = first.tools[0];
    const oldTool =
      descriptor === undefined ? undefined : first.registry.get(descriptor.registryName);

    await client.discoverTools({ ...context, generation: context.generation + 1 });

    expect(() => oldTool?.parseInput({})).toThrow(McpToolUnavailableError);
    if (oldTool?.prepareApproval === undefined)
      throw new Error("Expected Tool approval preparation.");
    await expect(
      oldTool.prepareApproval({}, { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(McpToolUnavailableError);
  });

  it("calls a current-generation Tool with validated arguments and normalizes its result", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") fixture.emitJson(discoveryResult(message));
      if (message.method === "tools/list") {
        fixture.emitJson(
          toolResponse(message, [
            {
              name: "calculate",
              inputSchema: {
                type: "object",
                properties: { count: { type: "integer" } },
                required: ["count"],
                additionalProperties: false,
              },
              outputSchema: {
                type: "object",
                properties: { total: { type: "integer" } },
                required: ["total"],
                additionalProperties: false,
              },
            },
          ]),
        );
      }
      if (message.method === "tools/call") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "calculated" }],
            structuredContent: { total: 6 },
          },
        });
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    const snapshot = await client.discoverTools(context);
    const descriptor = snapshot.tools[0];
    const tool =
      descriptor === undefined ? undefined : snapshot.registry.get(descriptor.registryName);

    await expect(
      tool?.execute({ count: 2 }, { signal: new AbortController().signal }),
    ).resolves.toEqual({
      output: {
        content: [{ type: "text", text: "calculated" }],
        structuredContent: { total: 6 },
      },
      truncated: false,
    });
    expect(port.messages.filter(isMethod("tools/call"))).toHaveLength(1);
    expect(readParams(port.messages.find(isMethod("tools/call")) ?? {})).toMatchObject({
      name: "calculate",
      arguments: { count: 2 },
    });
    await client.disconnect();
  });

  it("cancels tools/call on Run cancellation and accepts no late result", async () => {
    const port = toolServer((_message) => toolPage([{ name: "held", inputSchema: emptySchema }]));
    const client = new ControlledMcpClient(port);
    await client.connect();
    const snapshot = await client.discoverTools(context);
    const descriptor = snapshot.tools[0];
    const tool =
      descriptor === undefined ? undefined : snapshot.registry.get(descriptor.registryName);
    const controller = new AbortController();
    const execution = tool?.execute({}, { signal: controller.signal });
    const call = await port.waitForMessage(isMethod("tools/call"));

    const cancellation = new Error("run cancelled");
    controller.abort(cancellation);
    await expect(execution).rejects.toBe(cancellation);
    port.emitJson({
      jsonrpc: "2.0",
      id: jsonRpcId(call),
      result: { content: [{ type: "text", text: "late" }] },
    });
    expect(client.getToolSnapshot()).toBe(snapshot);
    await client.disconnect();
  });

  it("does not fulfill or retry input_required Tool results", async () => {
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") fixture.emitJson(discoveryResult(message));
      if (message.method === "tools/list") {
        fixture.emitJson(
          toolResponse(message, [{ name: "interactive", inputSchema: emptySchema }]),
        );
      }
      if (message.method === "tools/call") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          result: { resultType: "input_required", requestState: "must-not-return" },
        });
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    const snapshot = await client.discoverTools(context);
    const descriptor = snapshot.tools[0];
    const tool =
      descriptor === undefined ? undefined : snapshot.registry.get(descriptor.registryName);

    await expect(tool?.execute({}, { signal: new AbortController().signal })).rejects.toMatchObject(
      {
        code: "failed",
      },
    );
    expect(port.messages.filter(isMethod("tools/call"))).toHaveLength(1);
    expect(JSON.stringify(port.messages)).not.toContain("inputResponses");
    await client.disconnect();
  });

  it("revokes and cancels an in-flight Tool call before disconnect cleanup", async () => {
    const port = toolServer((_message) => toolPage([{ name: "held", inputSchema: emptySchema }]));
    const client = new ControlledMcpClient(port);
    await client.connect();
    const snapshot = await client.discoverTools(context);
    const descriptor = snapshot.tools[0];
    const tool =
      descriptor === undefined ? undefined : snapshot.registry.get(descriptor.registryName);
    const execution = tool?.execute({}, { signal: new AbortController().signal });
    const call = await port.waitForMessage(isMethod("tools/call"));

    await client.disconnect();
    await expect(execution).rejects.toBeDefined();
    port.emitJson({
      jsonrpc: "2.0",
      id: jsonRpcId(call),
      result: { resultType: "complete", content: [{ type: "text", text: "late" }] },
    });
    expect(client.getToolSnapshot()).toBeUndefined();
  });
});

function toolServer(
  list: (
    message: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>> | undefined,
): FixtureStdioPort {
  return new FixtureStdioPort((message, port) => {
    if (message.method === "server/discover") {
      port.emitJson({
        jsonrpc: "2.0",
        id: jsonRpcId(message),
        result: {
          resultType: "complete",
          supportedVersions: [mcpProtocolVersion],
          capabilities: { tools: { listChanged: true } },
        },
      });
    }
    if (message.method === "tools/list") {
      const result = list(message);
      if (result !== undefined) {
        port.emitJson({ jsonrpc: "2.0", id: jsonRpcId(message), result });
      }
    }
  });
}

function toolPage(
  tools: readonly Readonly<Record<string, unknown>>[],
  nextCursor?: string,
): Readonly<Record<string, unknown>> {
  return {
    resultType: "complete",
    ttlMs: 0,
    cacheScope: "private",
    tools,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function discoveryResult(
  message: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id: jsonRpcId(message),
    result: {
      resultType: "complete",
      supportedVersions: [mcpProtocolVersion],
      capabilities: { tools: { listChanged: true } },
    },
  };
}

function toolResponse(
  message: Readonly<Record<string, unknown>>,
  tools: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return { jsonrpc: "2.0", id: jsonRpcId(message), result: toolPage(tools) };
}

function readParams(message: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const params = message.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("Expected request params.");
  }
  return params as Readonly<Record<string, unknown>>;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}

const emptySchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;
