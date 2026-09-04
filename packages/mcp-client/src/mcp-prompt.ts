import { hasOnlyKeys, isPlainRecord } from "@ctrl-zebra/core";

import {
  type McpPromptDiscoveryContext,
  type McpServerIdentity,
  maxMcpDescriptorBytes,
  maxMcpListEntries,
  maxMcpListSnapshotBytes,
  maxMcpPromptArgumentNameCodePoints,
  maxMcpPromptArguments,
  maxMcpPromptArgumentsBytes,
  maxMcpPromptArgumentValueCodePoints,
  maxMcpPromptCodePoints,
  maxMcpPromptMessages,
  maxMcpPromptTextBytes,
} from "./contracts.js";
import { createMcpClientError } from "./errors.js";
import { utf8ByteLength } from "./text-primitives.js";

const promptKeys = new Set(["_meta", "arguments", "description", "icons", "name", "title"]);
const argumentKeys = new Set(["description", "name", "required", "title"]);
const resultKeys = new Set(["_meta", "ttlMs", "cacheScope", "description", "messages"]);
const messageKeys = new Set(["content", "role"]);
const contentKeys = new Set(["_meta", "annotations", "text", "type"]);

export interface McpPromptArgumentDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly required: boolean;
}

export interface McpPromptDescriptor {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly arguments: readonly McpPromptArgumentDescriptor[];
}

export interface McpPromptCatalogView {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly prompts: readonly McpPromptDescriptor[];
}

export interface McpPromptMessageView {
  readonly sourceRole: "user" | "assistant";
  readonly text: string;
}

export interface McpPromptResultView {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly promptName: string;
  readonly arguments: Readonly<Record<string, string>>;
  readonly messages: readonly McpPromptMessageView[];
}

export class McpPromptError extends Error {
  constructor(
    readonly code:
      | "malformed-message"
      | "limit-exceeded"
      | "prompt-unavailable"
      | "prompt-unsupported",
  ) {
    super(createMcpClientError(code).message);
    this.name = "McpPromptError";
  }
}

export function createMcpPromptCatalog(
  context: McpPromptDiscoveryContext,
  values: readonly unknown[],
): McpPromptCatalogView {
  if (values.length > maxMcpListEntries) throw new McpPromptError("limit-exceeded");
  const prompts: McpPromptDescriptor[] = [];
  const identities = new Set<string>();
  let snapshotBytes = 2;
  for (const [index, value] of values.entries()) {
    snapshotBytes = addDescriptorBytes(snapshotBytes, value, index);
    const record = readStrictRecord(value, promptKeys);
    const name = readText(record.name, false);
    if (identities.has(name)) throw new McpPromptError("malformed-message");
    identities.add(name);
    const rawArguments = record.arguments ?? [];
    if (!Array.isArray(rawArguments)) throw new McpPromptError("malformed-message");
    if (rawArguments.length > maxMcpPromptArguments) throw new McpPromptError("limit-exceeded");
    const argumentNames = new Set<string>();
    const argumentsValue = rawArguments.map((value) => {
      const argument = readStrictRecord(value, argumentKeys);
      const argumentName = readArgumentName(argument.name);
      if (argumentNames.has(argumentName)) throw new McpPromptError("malformed-message");
      argumentNames.add(argumentName);
      if (argument.required !== undefined && typeof argument.required !== "boolean") {
        throw new McpPromptError("malformed-message");
      }
      return {
        name: argumentName,
        ...(argument.description === undefined
          ? {}
          : { description: readText(argument.description, true) }),
        required: argument.required === true,
      };
    });
    prompts.push({
      ...context,
      name,
      ...(record.title === undefined ? {} : { title: readText(record.title, true) }),
      ...(record.description === undefined
        ? {}
        : { description: readText(record.description, true) }),
      arguments: argumentsValue,
    });
  }
  if (snapshotBytes > maxMcpListSnapshotBytes) throw new McpPromptError("limit-exceeded");
  return { ...context, prompts };
}

export function validateMcpPromptArguments(
  catalog: McpPromptCatalogView,
  promptName: string,
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const prompt = catalog.prompts.find(({ name }) => name === promptName);
  if (prompt === undefined) throw new McpPromptError("prompt-unavailable");
  const record = readRecord(value);
  const keys = Object.keys(record);
  if (keys.length > maxMcpPromptArguments) throw new McpPromptError("limit-exceeded");
  const advertised = new Map(prompt.arguments.map((argument) => [argument.name, argument]));
  if (
    keys.some((key) => !advertised.has(key)) ||
    prompt.arguments.some(({ name, required }) => required && !(name in record))
  ) {
    throw new McpPromptError("malformed-message");
  }
  let bytes = 2;
  const result: Record<string, string> = {};
  for (const key of keys.sort()) {
    readArgumentName(key);
    const argumentValue = record[key];
    if (
      typeof argumentValue !== "string" ||
      !argumentValue.isWellFormed() ||
      [...argumentValue].length > maxMcpPromptArgumentValueCodePoints
    ) {
      throw new McpPromptError("malformed-message");
    }
    bytes +=
      utf8ByteLength(JSON.stringify(key)) + utf8ByteLength(JSON.stringify(argumentValue)) + 2;
    if (bytes > maxMcpPromptArgumentsBytes) throw new McpPromptError("limit-exceeded");
    result[key] = argumentValue;
  }
  return result;
}

export function normalizeMcpPromptResult(
  context: McpPromptDiscoveryContext,
  promptName: string,
  argumentsValue: Readonly<Record<string, string>>,
  value: unknown,
): McpPromptResultView {
  const record = readRecord(value);
  if (record.status === "input_required") throw new McpPromptError("prompt-unsupported");
  if (Object.keys(record).some((key) => !resultKeys.has(key))) {
    throw new McpPromptError("malformed-message");
  }
  if (
    (record.ttlMs !== undefined &&
      (!Number.isSafeInteger(record.ttlMs) || (record.ttlMs as number) < 0)) ||
    (record.cacheScope !== undefined &&
      record.cacheScope !== "public" &&
      record.cacheScope !== "private")
  ) {
    throw new McpPromptError("malformed-message");
  }
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new McpPromptError("malformed-message");
  }
  if (record.messages.length > maxMcpPromptMessages) throw new McpPromptError("limit-exceeded");
  let codePoints = 0;
  let bytes = 0;
  const messages = record.messages.map((value) => {
    const message = readStrictRecord(value, messageKeys);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new McpPromptError("prompt-unsupported");
    }
    const content = readStrictRecord(message.content, contentKeys);
    if (content.type !== "text" || typeof content.text !== "string") {
      throw new McpPromptError("prompt-unsupported");
    }
    const text = readText(content.text, true);
    codePoints += [...text].length;
    bytes += utf8ByteLength(text);
    if (codePoints > maxMcpPromptCodePoints || bytes > maxMcpPromptTextBytes) {
      throw new McpPromptError("limit-exceeded");
    }
    return { sourceRole: message.role as "user" | "assistant", text };
  });
  return { ...context, promptName, arguments: argumentsValue, messages };
}

function readArgumentName(value: unknown): string {
  const name = readText(value, false);
  if ([...name].length > maxMcpPromptArgumentNameCodePoints) {
    throw new McpPromptError("limit-exceeded");
  }
  return name;
}

function readText(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || !value.isWellFormed()) {
    throw new McpPromptError("malformed-message");
  }
  return value;
}

function readStrictRecord(value: unknown, keys: ReadonlySet<string>) {
  const record = readRecord(value);
  if (!hasOnlyKeys(record, keys)) {
    throw new McpPromptError("malformed-message");
  }
  return record;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw new McpPromptError("malformed-message");
  }
  return value as Readonly<Record<string, unknown>>;
}

function addDescriptorBytes(current: number, value: unknown, index: number): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpPromptError("malformed-message");
  }
  if (serialized === undefined) throw new McpPromptError("malformed-message");
  const bytes = utf8ByteLength(serialized);
  if (bytes > maxMcpDescriptorBytes) throw new McpPromptError("limit-exceeded");
  return current + bytes + (index === 0 ? 0 : 1);
}
