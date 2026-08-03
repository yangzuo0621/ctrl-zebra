import type { JsonValue } from "@ctrl-zebra/core";
import type { JsonSchemaType } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";

import {
  maxMcpToolSchemaBytes,
  maxMcpToolSchemaDepth,
  maxMcpToolSchemaNodes,
  maxMcpToolSchemaProperties,
} from "./contracts.js";

const draft202012 = "https://json-schema.org/draft/2020-12/schema";
const schemaMapKeywords = new Set(["$defs", "properties"]);
const schemaKeywords = new Set(["additionalProperties", "items", "not"]);
const schemaArrayKeywords = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const stringKeywords = new Set(["$ref", "title", "description"]);
const numberKeywords = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maximum",
  "maxItems",
  "maxLength",
  "maxProperties",
  "minimum",
  "minItems",
  "minLength",
  "minProperties",
  "multipleOf",
]);
const jsonKeywords = new Set(["const", "default"]);
const allowedKeywords = new Set([
  "$schema",
  ...schemaMapKeywords,
  ...schemaKeywords,
  ...schemaArrayKeywords,
  ...stringKeywords,
  ...numberKeywords,
  ...jsonKeywords,
  "enum",
  "examples",
  "required",
  "type",
  "uniqueItems",
]);
const allowedTypes = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);

export interface CompiledExternalJsonSchema {
  readonly schema: Readonly<Record<string, JsonValue>>;
  validate(value: unknown): boolean;
}

export interface ExternalJsonSchemaValidator {
  compile(schema: Readonly<Record<string, JsonValue>>): CompiledExternalJsonSchema;
}

export class McpToolSchemaError extends Error {
  constructor() {
    super("MCP Tool schema is invalid or unsupported.");
    this.name = "McpToolSchemaError";
  }
}

export function createExternalJsonSchemaValidator(): ExternalJsonSchemaValidator {
  const provider = new AjvJsonSchemaValidator();
  return {
    compile(schema) {
      try {
        // The structural walker below establishes the SDK's Draft 2020-12 object contract.
        const validate = provider.getValidator<unknown>(schema as JsonSchemaType);
        return { schema, validate: (value) => validate(value).valid };
      } catch {
        throw new McpToolSchemaError();
      }
    },
  };
}

export function validateMcpToolSchema(value: unknown): Readonly<Record<string, JsonValue>> {
  const context: WalkContext = { nodes: 0, properties: 0, references: [] };
  const schema = walkSchema(value, context, 1, "#");
  if (schema === true || schema === false || schema.type !== "object") {
    throw new McpToolSchemaError();
  }
  if (utf8Bytes(JSON.stringify(schema)) > maxMcpToolSchemaBytes) {
    throw new McpToolSchemaError();
  }
  assertAcyclicReferences(schema, context.references);
  return schema;
}

interface WalkContext {
  nodes: number;
  properties: number;
  references: Array<{ readonly source: string; readonly target: string }>;
}

function walkSchema(
  value: unknown,
  context: WalkContext,
  depth: number,
  path: string,
): boolean | Readonly<Record<string, JsonValue>> {
  context.nodes += 1;
  if (context.nodes > maxMcpToolSchemaNodes || depth > maxMcpToolSchemaDepth) {
    throw new McpToolSchemaError();
  }
  if (typeof value === "boolean") {
    return value;
  }
  const record = readRecord(value);
  const result: Record<string, JsonValue> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (!allowedKeywords.has(key)) {
      throw new McpToolSchemaError();
    }
    const childPath = `${path}/${escapePointer(key)}`;
    if (schemaMapKeywords.has(key)) {
      const entries = readRecord(nested);
      if (key === "properties") {
        context.properties += Object.keys(entries).length;
        if (context.properties > maxMcpToolSchemaProperties) {
          throw new McpToolSchemaError();
        }
      }
      result[key] = Object.fromEntries(
        Object.entries(entries).map(([name, child]) => [
          name,
          walkSchema(child, context, depth + 1, `${childPath}/${escapePointer(name)}`),
        ]),
      );
    } else if (schemaKeywords.has(key)) {
      result[key] = walkSchema(nested, context, depth + 1, childPath);
    } else if (schemaArrayKeywords.has(key)) {
      if (!Array.isArray(nested) || nested.length === 0) {
        throw new McpToolSchemaError();
      }
      result[key] = nested.map((child, index) =>
        walkSchema(child, context, depth + 1, `${childPath}/${index}`),
      );
    } else if (key === "$schema") {
      if (nested !== draft202012) {
        throw new McpToolSchemaError();
      }
      result[key] = nested;
    } else if (key === "$ref") {
      if (typeof nested !== "string" || !nested.startsWith("#/") || nested.includes("%")) {
        throw new McpToolSchemaError();
      }
      context.references.push({ source: path, target: nested });
      result[key] = nested;
    } else if (stringKeywords.has(key)) {
      if (typeof nested !== "string" || !isWellFormedUnicode(nested)) {
        throw new McpToolSchemaError();
      }
      result[key] = nested;
    } else if (numberKeywords.has(key)) {
      if (typeof nested !== "number" || !Number.isFinite(nested)) {
        throw new McpToolSchemaError();
      }
      if (
        (key.startsWith("min") || key.startsWith("max")) &&
        (!Number.isSafeInteger(nested) || nested < 0)
      ) {
        throw new McpToolSchemaError();
      }
      if (key === "multipleOf" && nested <= 0) {
        throw new McpToolSchemaError();
      }
      result[key] = nested;
    } else if (key === "type") {
      result[key] = validateType(nested);
    } else if (key === "required") {
      result[key] = validateUniqueStrings(nested);
    } else if (key === "enum") {
      if (!Array.isArray(nested) || nested.length === 0) {
        throw new McpToolSchemaError();
      }
      result[key] = nested.map((entry) => cloneJsonValue(entry));
    } else if (key === "examples") {
      if (!Array.isArray(nested)) {
        throw new McpToolSchemaError();
      }
      result[key] = nested.map((entry) => cloneJsonValue(entry));
    } else if (key === "uniqueItems") {
      if (typeof nested !== "boolean") {
        throw new McpToolSchemaError();
      }
      result[key] = nested;
    } else if (jsonKeywords.has(key)) {
      result[key] = cloneJsonValue(nested);
    }
  }
  return result;
}

function validateType(value: unknown): JsonValue {
  if (typeof value === "string" && allowedTypes.has(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    const values = validateUniqueStrings(value);
    if (values.length > 0 && values.every((entry) => allowedTypes.has(entry))) {
      return values;
    }
  }
  throw new McpToolSchemaError();
}

function validateUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new McpToolSchemaError();
  }
  const values = value.map((entry) => String(entry));
  if (
    new Set(values).size !== values.length ||
    values.some((entry) => !isWellFormedUnicode(entry))
  ) {
    throw new McpToolSchemaError();
  }
  return values;
}

function cloneJsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && !isWellFormedUnicode(value)) {
      throw new McpToolSchemaError();
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new McpToolSchemaError();
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneJsonValue(entry, ancestors));
    }
    const record = readRecord(value);
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, cloneJsonValue(entry, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function assertAcyclicReferences(
  root: Readonly<Record<string, JsonValue>>,
  references: readonly { readonly source: string; readonly target: string }[],
): void {
  const graph = new Map<string, string[]>();
  for (const reference of references) {
    if (resolvePointer(root, reference.target) === undefined) {
      throw new McpToolSchemaError();
    }
    const edges = graph.get(reference.source) ?? [];
    edges.push(reference.target);
    graph.set(reference.source, edges);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visiting.has(path)) {
      throw new McpToolSchemaError();
    }
    if (visited.has(path)) {
      return;
    }
    visiting.add(path);
    for (const target of graph.get(path) ?? []) {
      visit(target);
    }
    visiting.delete(path);
    visited.add(path);
  };
  for (const path of graph.keys()) {
    visit(path);
  }
}

function resolvePointer(
  root: Readonly<Record<string, JsonValue>>,
  pointer: string,
): JsonValue | undefined {
  let current: JsonValue = root;
  for (const token of pointer.slice(2).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(key in current)
    ) {
      return undefined;
    }
    current = (current as Readonly<Record<string, JsonValue>>)[key] as JsonValue;
  }
  return current;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpToolSchemaError();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new McpToolSchemaError();
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new McpToolSchemaError();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new McpToolSchemaError();
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
