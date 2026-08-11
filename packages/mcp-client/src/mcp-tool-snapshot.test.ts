import { describe, expect, it } from "vitest";

import { createMcpRegistryName } from "./mcp-tool-name.js";
import { createExternalJsonSchemaValidator } from "./mcp-tool-schema.js";
import {
  createMcpToolSnapshot,
  McpToolExecutionUnavailableError,
  McpToolSnapshotError,
  McpToolUnavailableError,
} from "./mcp-tool-snapshot.js";

const server = { serverId: "local_fixture", displayName: "Local fixture" };
const validator = createExternalJsonSchemaValidator();

describe("MCP Tool snapshot", () => {
  it("atomically projects descriptors as conservative non-executable Core Tools", async () => {
    const snapshot = createMcpToolSnapshot(
      server,
      4,
      [
        {
          name: "calculate-total",
          title: "Calculate total",
          description: "Untrusted description",
          inputSchema: {
            type: "object",
            properties: { count: { type: "integer" } },
            required: ["count"],
            additionalProperties: false,
          },
          outputSchema: {
            type: "object",
            properties: { total: { type: "number" } },
            required: ["total"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          icons: [{ src: "https://example.com/icon.png" }],
          _meta: { ignored: true },
        },
      ],
      new Set(),
      validator,
    );
    const descriptor = snapshot.view.tools[0];
    const tool =
      descriptor === undefined ? undefined : snapshot.view.registry.get(descriptor.registryName);

    expect(snapshot.view).toMatchObject({ server, generation: 4 });
    expect(descriptor).toMatchObject({
      mcpToolName: "calculate-total",
      title: "Calculate total",
      description: "Untrusted description",
    });
    expect(tool?.risk).toBe("execute");
    expect(tool?.parseInput({ count: 2 })).toEqual({ count: 2 });
    expect(() => tool?.parseInput({ count: "2" })).toThrow();
    expect(snapshot.validateOutput(descriptor?.registryName ?? "missing", { total: 3 })).toBe(true);
    expect(snapshot.validateOutput(descriptor?.registryName ?? "missing", { total: "3" })).toBe(
      false,
    );
    await expect(
      tool?.execute({ count: 2 }, { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(McpToolExecutionUnavailableError);
  });

  it("revokes every old definition and treats rename as removal plus addition", () => {
    const oldSnapshot = createMcpToolSnapshot(
      server,
      1,
      [{ name: "old", inputSchema: emptySchema }],
      new Set(),
      validator,
    );
    const oldName = oldSnapshot.view.tools[0]?.registryName;
    const oldTool = oldName === undefined ? undefined : oldSnapshot.view.registry.get(oldName);
    oldSnapshot.revoke();
    const replacement = createMcpToolSnapshot(
      server,
      1,
      [{ name: "new", inputSchema: emptySchema }],
      new Set(),
      validator,
    );

    expect(() => oldTool?.parseInput({})).toThrow(McpToolUnavailableError);
    expect(replacement.view.tools.map((tool) => tool.mcpToolName)).toEqual(["new"]);
  });

  it.each([
    [
      [
        { name: "same", inputSchema: emptySchema },
        { name: "same", inputSchema: emptySchema },
      ],
    ],
    [[{ name: "bad", inputSchema: { type: "object", pattern: "(a+)+$" } }]],
    [[{ name: "task", inputSchema: emptySchema, execution: { taskSupport: "optional" } }]],
  ])("rejects a suspicious snapshot without partial registration %#", (tools) => {
    expect(() => createMcpToolSnapshot(server, 1, tools, new Set(), validator)).toThrow(
      McpToolSnapshotError,
    );
  });

  it("keeps valid siblings and projects stable rejection reasons", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 33; index += 1) {
      nested = { type: "array", items: nested };
    }
    const snapshot = createMcpToolSnapshot(
      server,
      1,
      [
        { name: "z-forbidden", inputSchema: { type: "object", pattern: "(a+)+$" } },
        { name: "a-unknown", inputSchema: { type: "object", unknownKeyword: true } },
        { name: "m-reference", inputSchema: { type: "object", $ref: "https://example.com" } },
        { name: "b-root", inputSchema: true },
        { name: "l-limit", inputSchema: { type: "object", properties: { nested } } },
        {
          name: "c-compile",
          inputSchema: { ...emptySchema, title: "compile-fails" },
        },
        { name: "valid", inputSchema: emptySchema },
      ],
      new Set(),
      {
        compile(schema) {
          if (schema.title === "compile-fails") throw new Error("validator failure");
          return validator.compile(schema);
        },
      },
    );

    expect(snapshot.view.tools.map((tool) => tool.mcpToolName)).toEqual(["valid"]);
    expect(snapshot.view.rejectedTools).toEqual([
      { mcpToolName: "a-unknown", reason: "unknown-keyword" },
      { mcpToolName: "b-root", reason: "non-object-root" },
      { mcpToolName: "c-compile", reason: "schema-invalid" },
      { mcpToolName: "l-limit", reason: "limit-exceeded" },
      { mcpToolName: "m-reference", reason: "invalid-reference" },
      { mcpToolName: "z-forbidden", reason: "forbidden-keyword" },
    ]);
    expect(snapshot.view.rejectedToolsTruncated).toBe(false);
  });

  it("sorts rejection names by Unicode scalar and truncates only the projection", () => {
    const rejected = Array.from({ length: 300 }, (_, index) => ({
      name: `rejected-${String(index).padStart(3, "0")}`,
      inputSchema: { type: "object", pattern: "(a+)+$" },
    }));
    const snapshot = createMcpToolSnapshot(
      server,
      1,
      [...rejected, { name: "accepted", inputSchema: emptySchema }],
      new Set(),
      validator,
    );

    expect(snapshot.view.tools.map((tool) => tool.mcpToolName)).toEqual(["accepted"]);
    expect(snapshot.view.rejectedTools).toHaveLength(256);
    expect(snapshot.view.rejectedToolsTruncated).toBe(true);
    expect(snapshot.view.rejectedTools[0]).toEqual({
      mcpToolName: "rejected-000",
      reason: "forbidden-keyword",
    });
    expect(snapshot.view.rejectedTools.at(-1)).toEqual({
      mcpToolName: "rejected-255",
      reason: "forbidden-keyword",
    });
    const unicodeSnapshot = createMcpToolSnapshot(
      server,
      1,
      [
        { name: "😀", inputSchema: { type: "object", pattern: "(a+)+$" } },
        { name: "\ue000", inputSchema: { type: "object", pattern: "(a+)+$" } },
        { name: "accepted", inputSchema: emptySchema },
      ],
      new Set(),
      validator,
    );
    const unicodeNames = unicodeSnapshot.view.rejectedTools
      .filter(({ mcpToolName }) => mcpToolName === "😀" || mcpToolName === "\ue000")
      .map(({ mcpToolName }) => mcpToolName);
    expect(unicodeNames).toEqual(["\ue000", "😀"]);
  });

  it("isolates built-in and reserved Registry names", () => {
    const externalName = createMcpRegistryName(server.serverId, "conflict");
    expect(() =>
      createMcpToolSnapshot(
        server,
        1,
        [{ name: "conflict", inputSchema: emptySchema }],
        new Set([externalName]),
        validator,
      ),
    ).toThrow(McpToolSnapshotError);
  });

  it("rejects an oversized descriptor before adapting or registering it", () => {
    expect(() =>
      createMcpToolSnapshot(
        server,
        1,
        [{ name: "oversized", description: "x".repeat(70_000), inputSchema: emptySchema }],
        new Set(),
        validator,
      ),
    ).toThrow(McpToolSnapshotError);
  });
});

const emptySchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;
