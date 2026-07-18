import { describe, expect, it, vi } from "vitest";
import { type AgentTool, DuplicateToolRegistrationError, ToolRegistry } from "./tool-registry.js";

function createTool(name: string): AgentTool<string, { readonly value: string }> {
  return {
    name,
    description: `Use ${name}.`,
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "Input value." },
      },
      required: ["value"],
      additionalProperties: false,
    },
    risk: "read",
    parseInput(value: unknown): string {
      if (typeof value !== "string") {
        throw new TypeError("Expected a string input.");
      }

      return value;
    },
    execute: vi.fn(async (input: string) => ({
      output: { value: input },
      truncated: false,
    })),
  };
}

describe("ToolRegistry", () => {
  it("registers and finds a tool by name", () => {
    const registry = new ToolRegistry();
    const tool = createTool("read_file");

    registry.register(tool);

    expect(registry.get("read_file")).toBe(tool);
  });

  it("keeps tools with different names independently addressable", () => {
    const registry = new ToolRegistry();
    const readTool = createTool("read_file");
    const searchTool = createTool("search_files");

    registry.register(readTool);
    registry.register(searchTool);

    expect(registry.get("read_file")).toBe(readTool);
    expect(registry.get("search_files")).toBe(searchTool);
  });

  it("rejects a duplicate name without replacing the original tool", () => {
    const registry = new ToolRegistry();
    const originalTool = createTool("read_file");
    const duplicateTool = createTool("read_file");

    registry.register(originalTool);

    expect(() => registry.register(duplicateTool)).toThrow(
      new DuplicateToolRegistrationError("read_file"),
    );
    expect(registry.get("read_file")).toBe(originalTool);
  });

  it("returns undefined for an unknown tool", () => {
    const registry = new ToolRegistry();

    expect(registry.get("missing_tool")).toBeUndefined();
  });

  it("returns stable declarations sorted by tool name without execution capabilities", () => {
    const registry = new ToolRegistry();
    registry.register(createTool("search_files"));
    registry.register(createTool("read_file"));

    expect(registry.declarations()).toEqual([
      {
        name: "read_file",
        description: "Use read_file.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string", description: "Input value." } },
          required: ["value"],
          additionalProperties: false,
        },
      },
      {
        name: "search_files",
        description: "Use search_files.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string", description: "Input value." } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    ]);
  });
});
