import { describe, expect, it, vi } from "vitest";
import { InvalidToolInputError, parseToolInput } from "./tool-input-validation.js";
import type { AgentTool } from "./tool-registry.js";

interface ReadFileInput {
  readonly path: string;
  readonly startLine?: number;
}

function createReadFileTool(): AgentTool<ReadFileInput, string> {
  return {
    name: "read_file",
    risk: "read",
    parseInput(value: unknown): ReadFileInput {
      if (!isPlainObject(value)) {
        throw new TypeError("Expected an object.");
      }

      const keys = Object.keys(value);
      if (keys.some((key) => key !== "path" && key !== "startLine")) {
        throw new TypeError("Unexpected field.");
      }

      if (typeof value.path !== "string") {
        throw new TypeError("Expected path to be a string.");
      }

      if (value.startLine !== undefined && typeof value.startLine !== "number") {
        throw new TypeError("Expected startLine to be a number.");
      }

      return value.startLine === undefined
        ? { path: value.path }
        : { path: value.path, startLine: value.startLine };
    },
    execute: vi.fn(async ({ path }) => ({ output: path, truncated: false })),
  };
}

describe("parseToolInput", () => {
  it("returns typed input after the selected tool parses an unknown value", () => {
    const tool = createReadFileTool();

    const input = parseToolInput(tool, { path: "src/index.ts", startLine: 10 });

    expect(input).toEqual({ path: "src/index.ts", startLine: 10 });
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing required parameter", {}],
    ["a parameter with the wrong type", { path: 42 }],
    ["an unreviewed extra dangerous field", { path: "src/index.ts", command: "delete" }],
  ])("rejects %s before execution", (_description, value) => {
    const tool = createReadFileTool();

    expect(() => parseToolInput(tool, value)).toThrow(new InvalidToolInputError("read_file"));
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("does not expose parser failures or the rejected input", () => {
    const tool = createReadFileTool();
    tool.parseInput = () => {
      throw new Error("secret-token from raw input");
    };

    let captured: unknown;
    try {
      parseToolInput(tool, { token: "secret-token" });
    } catch (error) {
      captured = error;
    }

    expect(captured).toEqual(new InvalidToolInputError("read_file"));
    expect(captured).not.toHaveProperty("cause");
  });
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
