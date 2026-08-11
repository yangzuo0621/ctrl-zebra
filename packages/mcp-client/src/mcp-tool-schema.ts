import type { JsonValue } from "@ctrl-zebra/core";
import type { JsonSchemaType } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";

import {
  type McpToolRejectionReason,
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
const strippedStringKeywords = new Set([
  "$comment",
  "$id",
  "contentEncoding",
  "contentMediaType",
  "format",
]);
const strippedBooleanKeywords = new Set(["deprecated", "nullable", "readOnly", "writeOnly"]);
const strippedSchemaKeywords = new Set([
  "contains",
  "contentSchema",
  "else",
  "if",
  "propertyNames",
  "then",
]);
const strippedSchemaMapKeywords = new Set(["dependentSchemas"]);
const strippedRequiredMapKeywords = new Set(["dependentRequired"]);
const strippedSchemaOrBooleanKeywords = new Set(["unevaluatedItems", "unevaluatedProperties"]);
const strippedNumberKeywords = new Set(["maxContains", "minContains"]);
const safeStripKeywords = new Set([
  ...strippedStringKeywords,
  ...strippedBooleanKeywords,
  ...strippedSchemaKeywords,
  ...strippedSchemaMapKeywords,
  ...strippedRequiredMapKeywords,
  ...strippedSchemaOrBooleanKeywords,
  ...strippedNumberKeywords,
]);
const forbiddenKeywords = new Set([
  "$dynamicAnchor",
  "$dynamicRef",
  "$recursiveAnchor",
  "$recursiveRef",
  "pattern",
  "patternProperties",
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
  constructor(readonly reason: McpToolRejectionReason = "schema-invalid") {
    super("MCP Tool schema is invalid or unsupported.");
    this.name = "McpToolSchemaError";
  }
}

export function createExternalJsonSchemaValidator(): ExternalJsonSchemaValidator {
  const provider = new AjvJsonSchemaValidator();
  return {
    compile(schema) {
      try {
        // The structural normalizer establishes the closed schema policy before SDK compilation.
        const validate = provider.getValidator<unknown>(schema as JsonSchemaType);
        return { schema, validate: (value) => validate(value).valid };
      } catch {
        throw new McpToolSchemaError();
      }
    },
  };
}

export function validateMcpToolSchema(value: unknown): Readonly<Record<string, JsonValue>> {
  measureRawJsonBytes(value, maxMcpToolSchemaBytes);
  const context: WalkContext = { nodes: 0, properties: 0, references: [] };
  const schema = walkSchema(value, context, 1, "#", undefined);
  if (schema === true || schema === false || schema.type !== "object") {
    throw new McpToolSchemaError("non-object-root");
  }
  const serialized = JSON.stringify(schema);
  if (serialized === undefined || utf8Bytes(serialized) > maxMcpToolSchemaBytes) {
    throw new McpToolSchemaError("limit-exceeded");
  }
  assertReferenceGraph(schema, context.references);
  return schema;
}

interface WalkContext {
  nodes: number;
  properties: number;
  references: Array<{ readonly sourceAnchor: string | undefined; readonly target: string }>;
}

function walkSchema(
  value: unknown,
  context: WalkContext,
  depth: number,
  path: string,
  sourceAnchor: string | undefined,
): boolean | Readonly<Record<string, JsonValue>> {
  context.nodes += 1;
  if (context.nodes > maxMcpToolSchemaNodes || depth > maxMcpToolSchemaDepth) {
    throw new McpToolSchemaError("limit-exceeded");
  }
  if (typeof value === "boolean") {
    return value;
  }

  const record = readRecord(value);
  const result = createRecord<JsonValue>();
  const definitionEntries = mergeDefinitionEntries(record);
  let wroteDefinitions = false;

  for (const [key, nested] of Object.entries(record)) {
    if (key === "definitions") {
      continue;
    }
    const childPath = `${path}/${escapePointer(key)}`;
    if (key === "$defs") {
      const entries = definitionEntries ?? readRecord(nested);
      setRecordValue(
        result,
        key,
        walkDefinitionMap(entries, context, depth + 1, `${path}/$defs`, path === "#", sourceAnchor),
      );
      wroteDefinitions = true;
      continue;
    }
    if (key === "definitions") {
      continue;
    }
    if (safeStripKeywords.has(key)) {
      walkStrippedKeyword(key, nested, context, depth + 1, childPath, sourceAnchor);
      continue;
    }
    if (!allowedKeywords.has(key)) {
      throw new McpToolSchemaError(
        forbiddenKeywords.has(key) ? "forbidden-keyword" : "unknown-keyword",
      );
    }
    if (schemaMapKeywords.has(key)) {
      const entries = readRecord(nested);
      if (key === "properties") {
        context.properties += Object.keys(entries).length;
        if (context.properties > maxMcpToolSchemaProperties) {
          throw new McpToolSchemaError("limit-exceeded");
        }
      }
      const mapped = createRecord<JsonValue>();
      for (const [name, child] of Object.entries(entries)) {
        assertWellFormed(name);
        setRecordValue(
          mapped,
          name,
          walkSchema(
            child,
            context,
            depth + 1,
            `${childPath}/${escapePointer(name)}`,
            sourceAnchor,
          ),
        );
      }
      setRecordValue(result, key, mapped);
    } else if (schemaKeywords.has(key)) {
      setRecordValue(result, key, walkSchema(nested, context, depth + 1, childPath, sourceAnchor));
    } else if (schemaArrayKeywords.has(key)) {
      if (!Array.isArray(nested) || nested.length === 0) {
        throw new McpToolSchemaError();
      }
      setRecordValue(
        result,
        key,
        nested.map((child, index) =>
          walkSchema(child, context, depth + 1, `${childPath}/${index}`, sourceAnchor),
        ),
      );
    } else if (key === "$schema") {
      if (nested !== draft202012) {
        throw new McpToolSchemaError("schema-invalid");
      }
      setRecordValue(result, key, nested);
    } else if (key === "$ref") {
      if (typeof nested !== "string" || !isWellFormedUnicode(nested)) {
        throw new McpToolSchemaError("invalid-reference");
      }
      const target = normalizeLocalReference(nested);
      context.references.push({ sourceAnchor, target });
      setRecordValue(result, key, target);
    } else if (key === "title" || key === "description") {
      if (typeof nested !== "string" || !isWellFormedUnicode(nested)) {
        throw new McpToolSchemaError();
      }
      setRecordValue(result, key, nested);
    } else if (numberKeywords.has(key)) {
      setRecordValue(result, key, validateNumberKeyword(key, nested));
    } else if (key === "type") {
      setRecordValue(result, key, validateType(nested));
    } else if (key === "required") {
      setRecordValue(result, key, validateUniqueStrings(nested));
    } else if (key === "enum") {
      if (!Array.isArray(nested) || nested.length === 0) {
        throw new McpToolSchemaError();
      }
      setRecordValue(
        result,
        key,
        nested.map((entry) => cloneJsonValue(entry)),
      );
    } else if (key === "examples") {
      if (!Array.isArray(nested)) {
        throw new McpToolSchemaError();
      }
      setRecordValue(
        result,
        key,
        nested.map((entry) => cloneJsonValue(entry)),
      );
    } else if (key === "uniqueItems") {
      if (typeof nested !== "boolean") {
        throw new McpToolSchemaError();
      }
      setRecordValue(result, key, nested);
    } else if (key === "const" || key === "default") {
      setRecordValue(result, key, cloneJsonValue(nested));
    }
  }

  if (definitionEntries !== undefined && !wroteDefinitions) {
    setRecordValue(
      result,
      "$defs",
      walkDefinitionMap(
        definitionEntries,
        context,
        depth + 1,
        `${path}/$defs`,
        path === "#",
        sourceAnchor,
      ),
    );
  }
  return result;
}

function mergeDefinitionEntries(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const legacy = record.definitions === undefined ? undefined : readRecord(record.definitions);
  const native = record.$defs === undefined ? undefined : readRecord(record.$defs);
  if (legacy === undefined && native === undefined) {
    return undefined;
  }
  const merged = createRecord<unknown>();
  if (native !== undefined) {
    for (const [name, value] of Object.entries(native)) {
      assertWellFormed(name);
      setRecordValue(merged, name, value);
    }
  }
  if (legacy !== undefined) {
    for (const [name, value] of Object.entries(legacy)) {
      assertWellFormed(name);
      if (hasOwn(merged, name)) {
        throw new McpToolSchemaError("schema-invalid");
      }
      setRecordValue(merged, name, value);
    }
  }
  return merged;
}

function walkDefinitionMap(
  entries: Readonly<Record<string, unknown>>,
  context: WalkContext,
  depth: number,
  path: string,
  rootDefinitions: boolean,
  sourceAnchor: string | undefined,
): Readonly<Record<string, JsonValue>> {
  const result = createRecord<JsonValue>();
  for (const [name, child] of Object.entries(entries)) {
    assertWellFormed(name);
    const childPath = `${path}/${escapePointer(name)}`;
    const childAnchor = rootDefinitions ? childPath : sourceAnchor;
    setRecordValue(result, name, walkSchema(child, context, depth + 1, childPath, childAnchor));
  }
  return result;
}

function walkStrippedKeyword(
  key: string,
  value: unknown,
  context: WalkContext,
  depth: number,
  path: string,
  sourceAnchor: string | undefined,
): void {
  if (strippedStringKeywords.has(key)) {
    if (typeof value !== "string" || !isWellFormedUnicode(value)) {
      throw new McpToolSchemaError();
    }
    return;
  }
  if (strippedBooleanKeywords.has(key)) {
    if (typeof value !== "boolean") {
      throw new McpToolSchemaError();
    }
    return;
  }
  if (strippedSchemaKeywords.has(key) || strippedSchemaOrBooleanKeywords.has(key)) {
    walkSchema(value, context, depth, path, sourceAnchor);
    return;
  }
  if (strippedSchemaMapKeywords.has(key)) {
    const entries = readRecord(value);
    for (const [name, child] of Object.entries(entries)) {
      assertWellFormed(name);
      walkSchema(child, context, depth, `${path}/${escapePointer(name)}`, sourceAnchor);
    }
    return;
  }
  if (strippedRequiredMapKeywords.has(key)) {
    const entries = readRecord(value);
    for (const [name, child] of Object.entries(entries)) {
      assertWellFormed(name);
      validateUniqueStrings(child);
    }
    return;
  }
  if (strippedNumberKeywords.has(key)) {
    validateNonnegativeInteger(value);
  }
}

function validateNumberKeyword(key: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new McpToolSchemaError();
  }
  if (
    (key.startsWith("min") || key.startsWith("max")) &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new McpToolSchemaError();
  }
  if (key === "multipleOf" && value <= 0) {
    throw new McpToolSchemaError();
  }
  return value;
}

function validateNonnegativeInteger(value: unknown): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new McpToolSchemaError();
  }
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
    const cloned = createRecord<JsonValue>();
    for (const [key, entry] of Object.entries(record)) {
      assertWellFormed(key);
      setRecordValue(cloned, key, cloneJsonValue(entry, ancestors));
    }
    return cloned;
  } finally {
    ancestors.delete(value);
  }
}

function assertReferenceGraph(
  root: Readonly<Record<string, JsonValue>>,
  references: readonly { readonly sourceAnchor: string | undefined; readonly target: string }[],
): void {
  const definitions = root.$defs;
  if (definitions === undefined || typeof definitions !== "object" || definitions === null) {
    if (references.length > 0) {
      throw new McpToolSchemaError("invalid-reference");
    }
    return;
  }
  const definitionRecord = readRecord(definitions);
  const graph = new Map<string, string[]>();
  for (const name of Object.keys(definitionRecord)) {
    graph.set(name, []);
  }
  for (const reference of references) {
    const targetName = referenceName(reference.target);
    if (!hasOwn(definitionRecord, targetName)) {
      throw new McpToolSchemaError("invalid-reference");
    }
    if (reference.sourceAnchor === undefined) {
      continue;
    }
    const sourceName = referenceName(reference.sourceAnchor);
    if (sourceName === targetName) {
      continue;
    }
    const edges = graph.get(sourceName);
    if (edges === undefined) {
      throw new McpToolSchemaError("invalid-reference");
    }
    edges.push(targetName);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visiting.has(name)) {
      throw new McpToolSchemaError("invalid-reference");
    }
    if (visited.has(name)) {
      return;
    }
    visiting.add(name);
    for (const target of graph.get(name) ?? []) {
      visit(target);
    }
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of graph.keys()) {
    visit(name);
  }
}

function normalizeLocalReference(value: string): string {
  if (!value.startsWith("#/") || value.includes("%")) {
    throw new McpToolSchemaError("invalid-reference");
  }
  const tokens = value.slice(2).split("/");
  if (tokens.length !== 2) {
    throw new McpToolSchemaError("invalid-reference");
  }
  const rootToken = decodePointerToken(tokens[0]);
  const name = decodePointerToken(tokens[1]);
  if ((rootToken !== "$defs" && rootToken !== "definitions") || name.length === 0) {
    throw new McpToolSchemaError("invalid-reference");
  }
  return `#/$defs/${escapePointer(name)}`;
}

function referenceName(value: string): string {
  const tokens = value.slice(2).split("/");
  if (tokens.length !== 2 || decodePointerToken(tokens[0]) !== "$defs") {
    throw new McpToolSchemaError("invalid-reference");
  }
  const name = decodePointerToken(tokens[1]);
  if (name.length === 0) {
    throw new McpToolSchemaError("invalid-reference");
  }
  return name;
}

function decodePointerToken(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "~") {
      const escapeCode = value[index + 1];
      if (escapeCode !== "0" && escapeCode !== "1") {
        throw new McpToolSchemaError("invalid-reference");
      }
      decoded += escapeCode === "0" ? "~" : "/";
      index += 1;
    } else {
      decoded += character;
    }
  }
  if (!isWellFormedUnicode(decoded)) {
    throw new McpToolSchemaError("invalid-reference");
  }
  return decoded;
}

function measureRawJsonBytes(
  value: unknown,
  maximum: number,
  ancestors = new Set<object>(),
  depth = 1,
): number {
  if (depth > maxMcpToolSchemaDepth) {
    throw new McpToolSchemaError("limit-exceeded");
  }
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) throw new McpToolSchemaError();
    return measuredStringBytes(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new McpToolSchemaError();
    return measuredStringBytes(String(value));
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new McpToolSchemaError();
  }
  ancestors.add(value);
  try {
    let total = Array.isArray(value) ? 2 : 2;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, String(index))) throw new McpToolSchemaError();
        total = boundedAdd(
          total,
          measureRawJsonBytes(value[index], maximum, ancestors, depth + 1),
          maximum,
        );
        if (index + 1 < value.length) total = boundedAdd(total, 1, maximum);
      }
    } else {
      const record = readRecord(value);
      let index = 0;
      for (const [key, child] of Object.entries(record)) {
        assertWellFormed(key);
        total = boundedAdd(total, measuredStringBytes(key), maximum);
        total = boundedAdd(total, 1, maximum);
        total = boundedAdd(
          total,
          measureRawJsonBytes(child, maximum, ancestors, depth + 1),
          maximum,
        );
        if (index + 1 < Object.keys(record).length) total = boundedAdd(total, 1, maximum);
        index += 1;
      }
    }
    return total;
  } finally {
    ancestors.delete(value);
  }
}

function boundedAdd(left: number, right: number, maximum: number): number {
  const total = left + right;
  if (total > maximum) throw new McpToolSchemaError("limit-exceeded");
  return total;
}

function measuredStringBytes(value: string): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : utf8Bytes(serialized);
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

function createRecord<T>(): Record<string, T> {
  return {};
}

function setRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function hasOwn(value: object, key: string): boolean {
  return Object.hasOwn(value, key);
}

function assertWellFormed(value: string): void {
  if (!isWellFormedUnicode(value)) {
    throw new McpToolSchemaError();
  }
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
