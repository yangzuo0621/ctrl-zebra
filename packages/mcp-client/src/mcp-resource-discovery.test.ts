import { describe, expect, it } from "vitest";

import { mcpProtocolVersion } from "./contracts.js";
import { ControlledMcpClient } from "./controlled-mcp-client.js";
import { FixtureStdioPort, isMethod, jsonRpcId } from "./fixture-stdio-port.js";

const context = {
  server: { serverId: "local_fixture", displayName: "Local fixture" },
  generation: 7,
} as const;

describe("ControlledMcpClient Resource operations", () => {
  it("collects both catalogs across all pages and publishes one snapshot", async () => {
    const port = resourceServer((message) => {
      if (message.method === "resources/list") {
        return readParams(message).cursor === undefined
          ? page("resources", [{ uri: "memory://first", name: "First" }], "next")
          : page("resources", [{ uri: "memory://second", name: "Second" }]);
      }
      return page("resourceTemplates", [{ uriTemplate: "docs://{section}", name: "Docs" }]);
    });
    const client = new ControlledMcpClient(port);
    await client.connect();

    const catalog = await client.discoverResources(context);

    expect(catalog.resources.map(({ uri }) => uri)).toEqual(["memory://first", "memory://second"]);
    expect(catalog.templates[0]?.arguments).toEqual([{ name: "section", required: true }]);
    expect(port.messages.filter(isMethod("resources/list"))).toHaveLength(2);
    await client.disconnect();
  });

  it("rejects duplicate cursors without replacing the last complete catalog", async () => {
    let malformed = false;
    const port = resourceServer((message) =>
      message.method === "resources/list"
        ? malformed
          ? page("resources", [], "repeat")
          : page("resources", [{ uri: "memory://stable", name: "Stable" }])
        : page("resourceTemplates", []),
    );
    const client = new ControlledMcpClient(port);
    await client.connect();
    const stable = await client.discoverResources(context);
    malformed = true;

    await expect(client.discoverResources(context)).rejects.toMatchObject({
      code: "malformed-message",
    });
    expect(client.getResourceCatalog()).toBe(stable);
    await client.disconnect();
  });

  it("coalesces list-changed races into serialized atomic catalog refreshes", async () => {
    const held: Readonly<Record<string, unknown>>[] = [];
    let resourceLists = 0;
    const port = new FixtureStdioPort((message, fixture) => {
      if (message.method === "server/discover") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          result: {
            resultType: "complete",
            supportedVersions: [mcpProtocolVersion],
            capabilities: { resources: { listChanged: true } },
          },
        });
      } else if (message.method === "resources/list") {
        resourceLists += 1;
        if (resourceLists === 1) {
          fixture.emitJson({
            jsonrpc: "2.0",
            id: jsonRpcId(message),
            result: page("resources", [{ uri: "memory://stable", name: "Stable" }]),
          });
        } else {
          held.push(message);
        }
      } else if (message.method === "resources/templates/list") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          result: page("resourceTemplates", []),
        });
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    const stable = await client.discoverResources(context);

    port.emitJson({ jsonrpc: "2.0", method: "notifications/resources/list_changed" });
    await waitFor(() => held.length === 1);
    port.emitJson({ jsonrpc: "2.0", method: "notifications/resources/list_changed" });
    const second = held[0];
    if (second === undefined) throw new Error("Expected first refresh.");
    expect(client.getResourceCatalog()).toBe(stable);
    port.emitJson({
      jsonrpc: "2.0",
      id: jsonRpcId(second),
      result: page("resources", [{ uri: "memory://second", name: "Second" }]),
    });
    await waitFor(() => held.length === 2);
    const third = held[1];
    if (third === undefined) throw new Error("Expected coalesced refresh.");
    port.emitJson({
      jsonrpc: "2.0",
      id: jsonRpcId(third),
      result: page("resources", [{ uri: "memory://third", name: "Third" }]),
    });
    await waitFor(() => client.getResourceCatalog()?.resources[0]?.name === "Third");

    expect(resourceLists).toBe(3);
    expect(client.getResourceCatalog()?.resources.map(({ name }) => name)).toEqual(["Third"]);
    await client.disconnect();
  });

  it("reads an explicitly selected Resource and does not retry input_required", async () => {
    const port = resourceServer((message, fixture) => {
      if (message.method === "resources/list") {
        return page("resources", [{ uri: "memory://note", name: "Note" }]);
      }
      if (message.method === "resources/templates/list") return page("resourceTemplates", []);
      if (message.method === "resources/read") {
        fixture.emitJson({
          jsonrpc: "2.0",
          id: jsonRpcId(message),
          result: {
            resultType: "input_required",
            requestState: "must-not-return",
          },
        });
      }
    });
    const client = new ControlledMcpClient(port);
    await client.connect();
    await client.discoverResources(context);

    await expect(
      client.readResource({ kind: "resource", uri: "memory://note" }),
    ).rejects.toMatchObject({ code: "resource-unsupported" });
    expect(port.messages.filter(isMethod("resources/read"))).toHaveLength(1);
    expect(JSON.stringify(port.messages)).not.toContain("inputResponses");
    await client.disconnect();
  });

  it("cancels an in-flight read and accepts no late snapshot after disconnect", async () => {
    const port = resourceServer((message) =>
      message.method === "resources/list"
        ? page("resources", [{ uri: "memory://held", name: "Held" }])
        : message.method === "resources/templates/list"
          ? page("resourceTemplates", [])
          : undefined,
    );
    const client = new ControlledMcpClient(port);
    await client.connect();
    await client.discoverResources(context);
    const read = client.readResource({ kind: "resource", uri: "memory://held" });
    const request = await port.waitForMessage(isMethod("resources/read"));

    await client.disconnect();
    await expect(read).rejects.toBeDefined();
    port.emitJson({
      jsonrpc: "2.0",
      id: jsonRpcId(request),
      result: {
        resultType: "complete",
        contents: [{ uri: "memory://held", text: "late" }],
      },
    });
    expect(client.getResourceCatalog()).toBeUndefined();
  });
});

function resourceServer(
  respond: (
    message: Readonly<Record<string, unknown>>,
    port: FixtureStdioPort,
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
          capabilities: { resources: { listChanged: true } },
        },
      });
      return;
    }
    const result = respond(message, port);
    if (result !== undefined) {
      port.emitJson({ jsonrpc: "2.0", id: jsonRpcId(message), result });
    }
  });
}

function page(
  field: "resources" | "resourceTemplates",
  values: readonly Readonly<Record<string, unknown>>[],
  nextCursor?: string,
) {
  return {
    resultType: "complete",
    ttlMs: 0,
    cacheScope: "private",
    [field]: values,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function readParams(message: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const params = message.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return {};
  return params as Readonly<Record<string, unknown>>;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}
