import { describe, expect, it } from "vitest";

import {
  jsonValueSchema,
  maxToolErrorMessageCharacters,
  maxToolResultBytes,
  type ToolCall,
  type ToolErrorCode,
  type ToolResult,
  toolCallSchema,
  toolResultSchema,
  toolRiskSchema,
} from "./index.js";

describe("Tool contracts", () => {
  it("round-trips a Tool Call with nested JSON input", () => {
    const call = {
      id: "call-1",
      name: "search_files",
      input: {
        query: "ToolCall",
        options: { caseSensitive: false, limit: 25 },
        extensions: ["ts", "tsx"],
        optional: null,
      },
    } satisfies ToolCall;

    expect(toolCallSchema.parse(JSON.parse(JSON.stringify(call)) as unknown)).toEqual(call);
  });

  it.each(["read", "write", "execute", "network"] as const)("accepts the %s risk level", (risk) => {
    expect(toolRiskSchema.parse(risk)).toBe(risk);
  });

  it.each([
    { id: "", name: "read_file", input: {} },
    { id: "x".repeat(129), name: "read_file", input: {} },
    { id: "call-1", name: "ReadFile", input: {} },
    { id: "call-1", name: "read-file", input: {} },
    { id: "call-1", name: "1read_file", input: {} },
    { id: "call-1", name: `r${"x".repeat(64)}`, input: {} },
    { id: "call-1", name: "read_file", input: {}, unexpected: true },
    { id: "call-1", name: "read_file", input: undefined },
    { id: "call-1", name: "read_file", input: Number.NaN },
    { id: "call-1", name: "read_file", input: Number.POSITIVE_INFINITY },
    { id: "call-1", name: "read_file", input: 1n },
    { id: "call-1", name: "read_file", input: new Date("2026-07-17T00:00:00Z") },
  ])("rejects an invalid Tool Call %#", (call) => {
    expect(toolCallSchema.safeParse(call).success).toBe(false);
  });

  it("rejects cyclic, sparse, accessor, symbol-keyed, and class JSON candidates", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const sparse = new Array<unknown>(1);
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "hidden work",
    });
    const symbolKeyed = { [Symbol("hidden")]: true };

    class JsonLookalike {
      readonly value = "not a plain object";
    }

    class ArrayLookalike extends Array<unknown> {}

    for (const value of [
      cyclic,
      sparse,
      accessor,
      symbolKeyed,
      new JsonLookalike(),
      new ArrayLookalike(),
    ]) {
      expect(jsonValueSchema.safeParse(value).success).toBe(false);
    }
  });

  it("round-trips success and structured error Tool Results", () => {
    const results = [
      {
        callId: "call-1",
        name: "list_files",
        status: "success",
        output: { files: ["AGENTS.md"], count: 1 },
        truncated: false,
      },
      {
        callId: "call-2",
        name: "read_file",
        status: "error",
        error: { code: "denied", message: "The requested file is outside the workspace." },
      },
    ] satisfies readonly ToolResult[];

    for (const result of results) {
      expect(toolResultSchema.parse(JSON.parse(JSON.stringify(result)) as unknown)).toEqual(result);
    }
  });

  it.each([
    "invalid-input",
    "unknown-tool",
    "denied",
    "failed",
    "invalid-output",
  ] as const)("accepts the stable %s error code", (code) => {
    const result: ToolResult = {
      callId: "call-1",
      name: "read_file",
      status: "error",
      error: { code: code satisfies ToolErrorCode, message: "Safe failure." },
    };

    expect(toolResultSchema.parse(result)).toEqual(result);
  });

  it.each([
    {
      callId: "call-1",
      name: "read_file",
      status: "success",
      output: "content",
      truncated: false,
      error: { code: "failed", message: "Unexpected field." },
    },
    {
      callId: "call-1",
      name: "read_file",
      status: "success",
      output: new Error("Host objects are not JSON output."),
      truncated: false,
    },
    {
      callId: "call-1",
      name: "read_file",
      status: "error",
      error: { code: "failed", message: "Failure." },
      output: null,
    },
    {
      callId: "call-1",
      name: "read_file",
      status: "error",
      error: { code: "cancelled", message: "Cancellation is not a Tool Result." },
    },
    {
      callId: "call-1",
      name: "read_file",
      status: "error",
      error: { code: "failed", message: "" },
    },
    {
      callId: "call-1",
      name: "read_file",
      status: "error",
      error: { code: "failed", message: "x".repeat(maxToolErrorMessageCharacters + 1) },
    },
  ])("rejects an invalid Tool Result %#", (result) => {
    expect(toolResultSchema.safeParse(result).success).toBe(false);
  });

  it("enforces the serialized Tool Result byte ceiling", () => {
    const oversizedResult = {
      callId: "call-1",
      name: "read_file",
      status: "success",
      output: "界".repeat(Math.ceil(maxToolResultBytes / 3)),
      truncated: true,
    };

    expect(JSON.stringify(oversizedResult).length).toBeLessThan(maxToolResultBytes);
    expect(toolResultSchema.safeParse(oversizedResult).success).toBe(false);
  });
});
