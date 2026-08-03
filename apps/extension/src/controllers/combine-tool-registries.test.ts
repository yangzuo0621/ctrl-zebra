import { ToolRegistry } from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { combineToolRegistries } from "./combine-tool-registries.js";

describe("combineToolRegistries", () => {
  it("combines built-in and current MCP definitions without changing either source", () => {
    const builtins = registry("read_file");
    const mcp = registry("mcp_read_123456789abc");

    const combined = combineToolRegistries(builtins, mcp);

    expect(combined.declarations().map(({ name }) => name)).toEqual([
      "mcp_read_123456789abc",
      "read_file",
    ]);
    expect(builtins.declarations().map(({ name }) => name)).toEqual(["read_file"]);
    expect(mcp.declarations().map(({ name }) => name)).toEqual(["mcp_read_123456789abc"]);
  });

  it("rejects a collision instead of partially replacing a definition", () => {
    expect(() => combineToolRegistries(registry("read_file"), registry("read_file"))).toThrow(
      "already registered",
    );
  });
});

function registry(name: "read_file" | "mcp_read_123456789abc"): ToolRegistry {
  const value = new ToolRegistry();
  value.register({
    name,
    description: name,
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    risk: "read",
    parseInput: () => null,
    execute: async () => ({ output: null, truncated: false }),
  });
  return value;
}
