import { describe, expect, it } from "vitest";

import { mcpProtocolVersion } from "./contracts.js";
import { ControlledMcpClient } from "./controlled-mcp-client.js";
import { FixtureStdioPort, isMethod, jsonRpcId } from "./fixture-stdio-port.js";

const context = {
  server: { serverId: "local_fixture", displayName: "Local fixture" },
  generation: 7,
} as const;

describe("ControlledMcpClient Prompt operations", () => {
  it("collects all pages and gets one explicitly selected Prompt", async () => {
    const port = promptServer((message) => {
      if (message.method === "prompts/list") {
        return readParams(message).cursor === undefined
          ? page([{ name: "first", arguments: [{ name: "topic", required: true }] }], "next")
          : page([{ name: "second" }]);
      }
      if (message.method === "prompts/get") {
        return complete({
          messages: [{ role: "user", content: { type: "text", text: "review security" } }],
        });
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    const catalog = await client.discoverPrompts(context);
    const result = await client.getPrompt("first", { topic: "security" });

    expect(catalog.prompts.map(({ name }) => name)).toEqual(["first", "second"]);
    expect(result.messages).toEqual([{ sourceRole: "user", text: "review security" }]);
    expect(port.messages.filter(isMethod("prompts/list"))).toHaveLength(2);
    expect(port.messages.filter(isMethod("prompts/get"))).toHaveLength(1);
    await client.disconnect();
  });

  it("retains the prior atomic catalog after a duplicate cursor", async () => {
    let malformed = false;
    const port = promptServer((message) =>
      message.method === "prompts/list"
        ? malformed
          ? page([], "repeat")
          : page([{ name: "stable" }])
        : undefined,
    );
    const client = new ControlledMcpClient(port);
    await client.connect();
    const stable = await client.discoverPrompts(context);
    malformed = true;
    await expect(client.discoverPrompts(context)).rejects.toMatchObject({
      code: "malformed-message",
    });
    expect(client.getPromptCatalog()).toBe(stable);
    await client.disconnect();
  });

  it("coalesces list-changed refreshes and replaces only complete catalogs", async () => {
    const held: Readonly<Record<string, unknown>>[] = [];
    let lists = 0;
    const port = promptServer((message) => {
      if (message.method !== "prompts/list") return undefined;
      lists += 1;
      if (lists === 1) return page([{ name: "stable" }]);
      held.push(message);
      return undefined;
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    const stable = await client.discoverPrompts(context);
    port.emitJson({ jsonrpc: "2.0", method: "notifications/prompts/list_changed" });
    await waitFor(() => held.length === 1);
    port.emitJson({ jsonrpc: "2.0", method: "notifications/prompts/list_changed" });
    const first = held[0];
    if (first === undefined) throw new Error("Expected refresh.");
    expect(client.getPromptCatalog()).toBe(stable);
    port.emitJson({ jsonrpc: "2.0", id: jsonRpcId(first), result: page([{ name: "second" }]) });
    await waitFor(() => held.length === 2);
    const second = held[1];
    if (second === undefined) throw new Error("Expected coalesced refresh.");
    port.emitJson({ jsonrpc: "2.0", id: jsonRpcId(second), result: page([{ name: "third" }]) });
    await waitFor(() => client.getPromptCatalog()?.prompts[0]?.name === "third");
    expect(lists).toBe(3);
    await client.disconnect();
  });

  it("does not fulfill or retry input_required", async () => {
    const port = promptServer((message) => {
      if (message.method === "prompts/list") return page([{ name: "review" }]);
      if (message.method === "prompts/get") {
        return { resultType: "input_required", requestState: "must-not-return" };
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    await client.discoverPrompts(context);
    await expect(client.getPrompt("review", {})).rejects.toMatchObject({
      code: "prompt-unsupported",
    });
    expect(port.messages.filter(isMethod("prompts/get"))).toHaveLength(1);
    expect(JSON.stringify(port.messages)).not.toContain("inputResponses");
    await client.disconnect();
  });

  it("accepts no late preview after disconnect", async () => {
    const port = promptServer((message) =>
      message.method === "prompts/list" ? page([{ name: "held" }]) : undefined,
    );
    const client = new ControlledMcpClient(port);
    await client.connect();
    await client.discoverPrompts(context);
    const result = client.getPrompt("held", {});
    const request = await port.waitForMessage(isMethod("prompts/get"));
    await client.disconnect();
    await expect(result).rejects.toBeDefined();
    port.emitJson({
      jsonrpc: "2.0",
      id: jsonRpcId(request),
      result: complete({ messages: [{ role: "user", content: { type: "text", text: "late" } }] }),
    });
    expect(client.getPromptCatalog()).toBeUndefined();
  });
});

function promptServer(
  respond: (
    message: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>> | undefined,
): FixtureStdioPort {
  return new FixtureStdioPort((message, port) => {
    if (message.method === "server/discover") {
      port.emitJson({
        jsonrpc: "2.0",
        id: jsonRpcId(message),
        result: complete({
          supportedVersions: [mcpProtocolVersion],
          capabilities: { prompts: { listChanged: true } },
        }),
      });
      return;
    }
    const result = respond(message);
    if (result !== undefined) port.emitJson({ jsonrpc: "2.0", id: jsonRpcId(message), result });
  });
}

function complete(value: Readonly<Record<string, unknown>>) {
  return { resultType: "complete", ...value };
}

function page(values: readonly Readonly<Record<string, unknown>>[], nextCursor?: string) {
  return complete({
    ttlMs: 0,
    cacheScope: "private",
    prompts: values,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
}

function readParams(message: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const params = message.params;
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? (params as Readonly<Record<string, unknown>>)
    : {};
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}
