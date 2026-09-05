import {
  hasOnlyKeys,
  isPlainRecord,
  isRecord,
  type JsonValue,
  jsonValueSchema,
  ToolExecutionError,
  toolNameSchema,
  utf8ByteLength,
} from "@ctrl-zebra/core";

import {
  type McpServerIdentity,
  type McpToolArguments,
  maxMcpToolArgumentsBytes,
  maxMcpToolStructuredContentBytes,
  maxMcpToolTextBytes,
  maxMcpToolTextCodePoints,
  maxMcpToolTextItems,
} from "./contracts.js";
import type { CompiledExternalJsonSchema } from "./mcp-tool-schema.js";

export interface McpToolApprovalPreparation {
  readonly kind: "mcp-tool-call";
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly registryName: string;
  readonly mcpToolName: string;
  readonly schemaId: string;
  readonly arguments: McpToolArguments;
}

export interface NormalizedMcpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent?: JsonValue;
}

export function parseMcpToolArguments(value: unknown): McpToolArguments {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success || !isMcpToolArguments(parsed.data)) {
    throw new ToolExecutionError("invalid-output", "MCP Tool arguments are invalid or too large.");
  }
  if (serializedBytes(parsed.data) > maxMcpToolArgumentsBytes) {
    throw new ToolExecutionError("invalid-output", "MCP Tool arguments are invalid or too large.");
  }
  return parsed.data;
}

export function parseMcpToolApprovalPreparation(value: unknown): McpToolApprovalPreparation {
  const record = readStrictRecord(value, [
    "arguments",
    "generation",
    "kind",
    "mcpToolName",
    "registryName",
    "schemaId",
    "server",
  ]);
  const server = readStrictRecord(record.server, ["displayName", "serverId"]);
  const generation = record.generation;
  if (
    record.kind !== "mcp-tool-call" ||
    !Number.isSafeInteger(generation) ||
    (generation as number) <= 0 ||
    !toolNameSchema.safeParse(record.registryName).success ||
    typeof record.mcpToolName !== "string" ||
    record.mcpToolName.length === 0 ||
    typeof record.schemaId !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.schemaId) ||
    typeof server.serverId !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(server.serverId) ||
    typeof server.displayName !== "string" ||
    server.displayName.length === 0
  ) {
    throw new ToolExecutionError("invalid-output", "MCP Tool approval data is invalid.");
  }
  return {
    kind: "mcp-tool-call",
    server: { serverId: server.serverId, displayName: server.displayName },
    generation: generation as number,
    registryName: record.registryName as string,
    mcpToolName: record.mcpToolName,
    schemaId: record.schemaId,
    arguments: parseMcpToolArguments(record.arguments),
  };
}

export function normalizeMcpToolResult(
  value: unknown,
  outputValidator?: CompiledExternalJsonSchema,
): NormalizedMcpToolResult {
  const record = readStrictRecord(value, [
    "_meta",
    "content",
    "isError",
    "resultType",
    "structuredContent",
  ]);
  if (record.resultType !== undefined && record.resultType !== "complete") {
    throw invalidResult();
  }
  if (record.isError !== undefined && typeof record.isError !== "boolean") {
    throw invalidResult();
  }
  if (record.isError === true) {
    throw new ToolExecutionError("failed", "The external MCP Tool reported a failure.");
  }
  if (!Array.isArray(record.content) || record.content.length > maxMcpToolTextItems) {
    throw invalidResult();
  }

  const content: { readonly type: "text"; readonly text: string }[] = [];
  let textCodePoints = 0;
  let textBytes = 0;
  for (const item of record.content) {
    const block = readStrictRecord(item, ["_meta", "annotations", "text", "type"]);
    if (block.type !== "text" || typeof block.text !== "string" || !block.text.isWellFormed()) {
      throw invalidResult();
    }
    textCodePoints += [...block.text].length;
    textBytes += utf8ByteLength(block.text);
    if (textCodePoints > maxMcpToolTextCodePoints || textBytes > maxMcpToolTextBytes) {
      throw invalidResult();
    }
    content.push({ type: "text", text: block.text });
  }

  let structuredContent: JsonValue | undefined;
  if (record.structuredContent !== undefined) {
    const parsed = jsonValueSchema.safeParse(record.structuredContent);
    if (
      !parsed.success ||
      !isJsonObject(parsed.data) ||
      serializedBytes(parsed.data) > maxMcpToolStructuredContentBytes
    ) {
      throw invalidResult();
    }
    structuredContent = parsed.data;
  }
  if (
    outputValidator !== undefined &&
    (structuredContent === undefined || !outputValidator.validate(structuredContent))
  ) {
    throw new ToolExecutionError(
      "invalid-output",
      "The external MCP Tool returned structured content that does not match its output schema.",
    );
  }

  return {
    content,
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}

function readStrictRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw invalidResult();
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (!hasOnlyKeys(record, new Set(allowedKeys))) {
    throw invalidResult();
  }
  return record;
}

function invalidResult(): ToolExecutionError {
  return new ToolExecutionError("invalid-output", "The external MCP Tool returned invalid output.");
}

function serializedBytes(value: JsonValue): number {
  return utf8ByteLength(JSON.stringify(value));
}

function isMcpToolArguments(value: JsonValue): value is McpToolArguments {
  return isJsonObject(value);
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return isRecord(value);
}
