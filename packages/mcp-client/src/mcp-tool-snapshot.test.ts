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
    expect(() => tool?.parseInput({ count: "2" })).toThrow(McpToolUnavailableError);
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
    [[{ name: "bad", inputSchema: { type: "object", format: "email" } }]],
    [[{ name: "task", inputSchema: emptySchema, execution: { taskSupport: "optional" } }]],
  ])("rejects a suspicious snapshot without partial registration %#", (tools) => {
    expect(() => createMcpToolSnapshot(server, 1, tools, new Set(), validator)).toThrow(
      McpToolSnapshotError,
    );
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
