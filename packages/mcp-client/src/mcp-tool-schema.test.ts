import { describe, expect, it } from "vitest";
import { maxMcpToolSchemaBytes, maxMcpToolSchemaProperties } from "./contracts.js";
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
    { type: "object", pattern: "(a+)+$" },
    { type: "object", $dynamicRef: "#/$defs/value" },
    { type: "object", $dynamicAnchor: "value" },
    { type: "object", $recursiveRef: "#" },
    { type: "object", $recursiveAnchor: true },
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

  it("strips known compatibility keywords while retaining the reviewed subset", () => {
    const schema = validateMcpToolSchema({
      type: "object",
      $id: "https://example.com/schema",
      $comment: "untrusted annotation",
      format: "uri",
      readOnly: true,
      writeOnly: false,
      deprecated: true,
      nullable: true,
      if: { type: "object", properties: { flag: { type: "boolean" } } },
      // biome-ignore lint/suspicious/noThenProperty: this is the JSON Schema conditional keyword.
      then: { required: ["flag"] },
      else: false,
      dependentSchemas: { flag: { properties: { value: { type: "string" } } } },
      dependentRequired: { flag: ["value"] },
      propertyNames: { type: "string" },
      contains: { type: "string" },
      minContains: 1,
      maxContains: 2,
      unevaluatedProperties: false,
      unevaluatedItems: { type: "string" },
      contentEncoding: "base64",
      contentMediaType: "application/json",
      contentSchema: { type: "object" },
      properties: { value: { type: "string" } },
    });

    expect(schema).toEqual({
      type: "object",
      properties: { value: { type: "string" } },
    });
    const compiled = createExternalJsonSchemaValidator().compile(schema);
    expect(compiled.validate({ value: "ok" })).toBe(true);
    expect(compiled.validate({ value: 1 })).toBe(false);
  });

  it("walks stripped branches so hidden dangerous or unknown keywords remain rejected", () => {
    expect(() => validateMcpToolSchema({ type: "object", if: { pattern: "(a+)+$" } })).toThrow(
      expect.objectContaining({ reason: "forbidden-keyword" }),
    );
    expect(() =>
      validateMcpToolSchema({
        type: "object",
        dependentSchemas: { value: { unknownKeyword: true } },
      }),
    ).toThrow(expect.objectContaining({ reason: "unknown-keyword" }));
  });

  it("converts legacy definitions and rewrites local references without changing semantics", () => {
    const schema = validateMcpToolSchema({
      type: "object",
      definitions: {
        node: {
          type: "object",
          properties: { child: { $ref: "#/definitions/node" } },
        },
      },
      properties: { root: { $ref: "#/definitions/node" } },
      required: ["root"],
    });
    const defs = schema.$defs as Record<string, Record<string, unknown>>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const nodeProperties = defs.node?.properties as Record<string, Record<string, unknown>>;
    expect(defs.node).toBeDefined();
    expect(properties.root?.$ref).toBe("#/$defs/node");
    expect(nodeProperties.child?.$ref).toBe("#/$defs/node");

    const compiled = createExternalJsonSchemaValidator().compile(schema);
    expect(compiled.validate({ root: { child: { child: {} } } })).toBe(true);
    expect(compiled.validate({ root: { child: 1 } })).toBe(false);
  });

  it("rejects definition collisions and accepts direct self-recursion only", () => {
    expect(() =>
      validateMcpToolSchema({
        type: "object",
        definitions: { value: { type: "string" } },
        $defs: { value: { type: "number" } },
      }),
    ).toThrow(expect.objectContaining({ reason: "schema-invalid" }));

    const recursive = validateMcpToolSchema({
      type: "object",
      $defs: {
        node: {
          type: "object",
          properties: { child: { $ref: "#/$defs/node" } },
        },
      },
      properties: { root: { $ref: "#/$defs/node" } },
    });
    expect(recursive.$defs).toBeDefined();

    expect(() =>
      validateMcpToolSchema({
        type: "object",
        $defs: {
          first: { $ref: "#/$defs/second" },
          second: { $ref: "#/$defs/first" },
        },
      }),
    ).toThrow(expect.objectContaining({ reason: "invalid-reference" }));
  });

  it.each([
    "#",
    "#/properties/value",
    "#/$defs/value/properties/child",
  ])("rejects root, non-anchor, and nested local reference target %s", (target) => {
    expect(() =>
      validateMcpToolSchema({
        type: "object",
        $defs: { value: { type: "string" } },
        properties: { value: { $ref: target } },
      }),
    ).toThrow(expect.objectContaining({ reason: "invalid-reference" }));
  });

  it("enforces original bytes and property limits before stripping or compiling", () => {
    expect(() =>
      validateMcpToolSchema({ type: "object", format: "x".repeat(maxMcpToolSchemaBytes) }),
    ).toThrow(expect.objectContaining({ reason: "limit-exceeded" }));

    const properties = Object.fromEntries(
      Array.from({ length: maxMcpToolSchemaProperties + 1 }, (_, index) => [
        `property-${index}`,
        { type: "string" },
      ]),
    );
    expect(() => validateMcpToolSchema({ type: "object", properties })).toThrow(
      expect.objectContaining({ reason: "limit-exceeded" }),
    );
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
