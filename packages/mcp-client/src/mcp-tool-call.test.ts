import { ToolExecutionError } from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { maxMcpToolTextBytes } from "./contracts.js";
import {
  normalizeMcpToolResult,
  parseMcpToolApprovalPreparation,
  parseMcpToolArguments,
} from "./mcp-tool-call.js";

describe("MCP Tool call boundary", () => {
  it("normalizes supported text and structured JSON", () => {
    expect(
      normalizeMcpToolResult(
        {
          content: [{ type: "text", text: "done", annotations: { ignored: true } }],
          structuredContent: { total: 3 },
        },
        { schema: {}, validate: (value) => JSON.stringify(value) === '{"total":3}' },
      ),
    ).toEqual({
      content: [{ type: "text", text: "done" }],
      structuredContent: { total: 3 },
    });
  });

  it.each([
    { content: [{ type: "image", data: "ignored" }] },
    { content: [{ type: "text", text: "\ud800" }] },
    { content: [{ type: "text", text: "x".repeat(maxMcpToolTextBytes + 1) }] },
    { content: [], structuredContent: ["not", "an", "object"] },
    { content: [], unexpected: true },
  ])("rejects unsupported, malformed, or oversized content %#", (value) => {
    expect(() => normalizeMcpToolResult(value)).toThrowError(
      expect.objectContaining({ code: "invalid-output" }),
    );
  });

  it("keeps Server Tool errors and output-schema failures distinct", () => {
    expect(() => normalizeMcpToolResult({ content: [], isError: true })).toThrowError(
      expect.objectContaining({ code: "failed" }),
    );
    expect(() =>
      normalizeMcpToolResult(
        { content: [], structuredContent: { total: "bad" } },
        { schema: {}, validate: () => false },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-output" }));
    expect(() =>
      normalizeMcpToolResult({ content: [] }, { schema: {}, validate: () => true }),
    ).toThrowError(expect.objectContaining({ code: "invalid-output" }));
  });

  it("accepts only bounded JSON objects as Tool arguments", () => {
    expect(parseMcpToolArguments({ count: 2 })).toEqual({ count: 2 });
    expect(() => parseMcpToolArguments([])).toThrow(ToolExecutionError);
    expect(() => parseMcpToolArguments({ value: undefined })).toThrow(ToolExecutionError);
  });

  it("strictly validates approval preparation provenance", () => {
    const preparation = {
      kind: "mcp-tool-call",
      server: { serverId: "local_fixture", displayName: "Fixture" },
      generation: 2,
      registryName: "mcp_run_123456789abc",
      mcpToolName: "run",
      schemaId: "a".repeat(64),
      arguments: { count: 2 },
    };
    expect(parseMcpToolApprovalPreparation(preparation)).toEqual(preparation);
    expect(() =>
      parseMcpToolApprovalPreparation({ ...preparation, generation: 3, extra: true }),
    ).toThrow(ToolExecutionError);
  });
});
