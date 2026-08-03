import { describe, expect, it } from "vitest";

import {
  createExternalJsonSchemaValidator,
  McpToolSchemaError,
  validateMcpToolSchema,
} from "./mcp-tool-schema.js";

describe("MCP Tool JSON Schema boundary", () => {
  it("accepts and compiles the authorized Draft 2020-12 subset without coercion or defaults", () => {
    const schema = validateMcpToolSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: {
        count: { type: "integer", minimum: 1 },
      },
      properties: {
        count: { $ref: "#/$defs/count" },
        mode: { enum: ["safe", "fast"] },
      },
      required: ["count"],
      additionalProperties: false,
    });
    const compiled = createExternalJsonSchemaValidator().compile(schema);

    expect(compiled.validate({ count: 2, mode: "safe" })).toBe(true);
    expect(compiled.validate({ count: "2" })).toBe(false);
    expect(compiled.validate({})).toBe(false);
  });

  it.each([
    { type: "object", patternProperties: { ".*": { type: "string" } } },
    { type: "object", properties: {}, $ref: "https://example.com/schema" },
    { type: "object", properties: {}, $schema: "http://json-schema.org/draft-07/schema#" },
    { type: "string" },
  ])("rejects unsupported or non-object input schema %#", (schema) => {
    expect(() => validateMcpToolSchema(schema)).toThrow(McpToolSchemaError);
  });

  it("rejects missing and cyclic local references", () => {
    expect(() =>
      validateMcpToolSchema({
        type: "object",
        properties: { value: { $ref: "#/$defs/missing" } },
      }),
    ).toThrow(McpToolSchemaError);
    expect(() =>
      validateMcpToolSchema({
        type: "object",
        $defs: {
          first: { $ref: "#/$defs/second" },
          second: { $ref: "#/$defs/first" },
        },
      }),
    ).toThrow(McpToolSchemaError);
  });

  it("rejects schemas beyond the structural depth bound", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 33; index += 1) {
      nested = { type: "array", items: nested };
    }

    expect(() => validateMcpToolSchema({ type: "object", properties: { nested } })).toThrow(
      McpToolSchemaError,
    );
  });
});
