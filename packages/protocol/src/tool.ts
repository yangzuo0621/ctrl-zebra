import { z } from "zod";

export const maxToolResultBytes = 1_048_576;
export const maxToolErrorMessageCharacters = 1_024;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export const jsonValueSchema = z.custom<JsonValue>(isJsonValue, {
  error: "Expected a JSON-serializable value.",
});

export const toolCallIdSchema = z.string().min(1).max(128);
export const toolNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const toolRiskSchema = z.enum(["read", "write", "execute", "network"]);

export const toolCallSchema = z.strictObject({
  id: toolCallIdSchema,
  name: toolNameSchema,
  input: jsonValueSchema,
});

export const toolErrorCodeSchema = z.enum([
  "invalid-input",
  "unknown-tool",
  "denied",
  "failed",
  "invalid-output",
]);

export const toolErrorSchema = z.strictObject({
  code: toolErrorCodeSchema,
  message: z.string().min(1).max(maxToolErrorMessageCharacters),
});

export const toolSuccessResultSchema = z.strictObject({
  callId: toolCallIdSchema,
  name: toolNameSchema,
  status: z.literal("success"),
  output: jsonValueSchema,
  truncated: z.boolean(),
});

export const toolErrorResultSchema = z.strictObject({
  callId: toolCallIdSchema,
  name: toolNameSchema,
  status: z.literal("error"),
  error: toolErrorSchema,
});

export const toolResultSchema = z
  .discriminatedUnion("status", [toolSuccessResultSchema, toolErrorResultSchema])
  .superRefine((result, context) => {
    if (utf8ByteLength(JSON.stringify(result)) > maxToolResultBytes) {
      context.addIssue({
        code: "custom",
        message: `Tool Result exceeds the ${maxToolResultBytes}-byte serialized limit.`,
      });
    }
  });

export type ToolCallId = z.infer<typeof toolCallIdSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolRisk = z.infer<typeof toolRiskSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolErrorCode = z.infer<typeof toolErrorCodeSchema>;
export type ToolError = z.infer<typeof toolErrorSchema>;
export type ToolSuccessResult = z.infer<typeof toolSuccessResultSchema>;
export type ToolErrorResult = z.infer<typeof toolErrorResultSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);

  try {
    return Array.isArray(value) ? isJsonArray(value, ancestors) : isJsonObject(value, ancestors);
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
}

function isJsonArray(value: readonly unknown[], ancestors: Set<object>): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }

  const keys = Reflect.ownKeys(value);

  if (keys.length !== value.length + 1 || keys.at(-1) !== "length") {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (keys[index] !== String(index)) {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return false;
    }

    if (!isJsonValue(descriptor.value, ancestors)) {
      return false;
    }
  }

  return true;
}

function isJsonObject(value: object, ancestors: Set<object>): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return false;
    }

    if (!isJsonValue(descriptor.value, ancestors)) {
      return false;
    }
  }

  return true;
}

function utf8ByteLength(value: string): number {
  let length = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0x7f) {
      length += 1;
    } else if (codePoint <= 0x7ff) {
      length += 2;
    } else if (codePoint <= 0xffff) {
      length += 3;
    } else {
      length += 4;
    }
  }

  return length;
}
