import { describe, expect, it } from "vitest";

import { createMcpRegistryName } from "./mcp-tool-name.js";

describe("MCP Tool registry names", () => {
  it("maps an external identity deterministically into the reserved lower snake_case prefix", () => {
    const name = createMcpRegistryName("local_fixture", "Read / Strange 🦓 Tool");

    expect(name).toMatch(/^mcp_read_strange_tool_[0-9a-f]{12}$/);
    expect(createMcpRegistryName("local_fixture", "Read / Strange 🦓 Tool")).toBe(name);
    expect(createMcpRegistryName("other_server", "Read / Strange 🦓 Tool")).not.toBe(name);
  });

  it("bounds the slug and uses a stable fallback when it has no ASCII characters", () => {
    expect(createMcpRegistryName("local_fixture", "🦓")).toMatch(/^mcp_tool_[0-9a-f]{12}$/);
    expect(createMcpRegistryName("local_fixture", "A".repeat(200))).toMatch(
      /^mcp_a{47}_[0-9a-f]{12}$/,
    );
  });
});
