import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";
import { ToolExecutionError } from "@ctrl-zebra/core";
import {
  type IdeLanguageLocationsResultDto,
  type IdePositionDto,
  type IdeSymbolsResultDto,
  ideLanguageLocationsResultSchema,
  ideSymbolsResultSchema,
  maxIdePositionCharacter,
  maxIdePositionLine,
  maxIdeUriPathBytes,
  maxIdeUriPathCodePoints,
  utf8ByteLength,
} from "@ctrl-zebra/protocol";

import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";

export interface LanguageServiceInput {
  readonly path: string;
  readonly position: IdePositionDto;
}

export interface ListSymbolsInput {
  readonly path: string;
}

export interface IdeLanguageServicePort {
  findDefinition(input: LanguageServiceInput, signal: AbortSignal): Promise<unknown>;
  findReferences(input: LanguageServiceInput, signal: AbortSignal): Promise<unknown>;
  listSymbols(input: ListSymbolsInput, signal: AbortSignal): Promise<unknown>;
}

export class LanguageServiceUnavailableError extends Error {
  constructor() {
    super("Language service is unavailable.");
    this.name = "LanguageServiceUnavailableError";
  }
}

export class InvalidLanguageServiceOutputError extends Error {
  constructor() {
    super("Language service returned invalid output.");
    this.name = "InvalidLanguageServiceOutputError";
  }
}

export type LanguageLocationOperation = "definition" | "references";

export function createLanguageLocationTool(
  operation: LanguageLocationOperation,
  name: string,
  description: string,
  portCall: (
    port: IdeLanguageServicePort,
    input: LanguageServiceInput,
    signal: AbortSignal,
  ) => Promise<unknown>,
  port: IdeLanguageServicePort,
): AgentTool<LanguageServiceInput, IdeLanguageLocationsResultDto> {
  return {
    name,
    description,
    inputSchema: languageLocationInputSchema,
    risk: "read",
    parseInput: parseLanguageServiceInput,
    async execute(input, { signal }): Promise<ToolExecutionOutput<IdeLanguageLocationsResultDto>> {
      signal.throwIfAborted();

      let value: unknown;
      try {
        value = await portCall(port, input, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof LanguageServiceUnavailableError) {
          throw new ToolExecutionError("failed", error.message);
        }
        if (error instanceof InvalidLanguageServiceOutputError) {
          throw new ToolExecutionError("invalid-output", error.message);
        }
        throw error;
      }

      signal.throwIfAborted();
      const result = ideLanguageLocationsResultSchema.safeParse(value);
      if (!result.success || result.data.operation !== operation) {
        throw new ToolExecutionError("invalid-output", "Language service returned invalid output.");
      }

      return { output: result.data, truncated: result.data.truncated };
    },
  };
}

export function createListSymbolsTool(
  port: IdeLanguageServicePort,
): AgentTool<ListSymbolsInput, IdeSymbolsResultDto> {
  return {
    name: "list_symbols",
    description: "List bounded symbols for one workspace document.",
    inputSchema: listSymbolsInputSchema,
    risk: "read",
    parseInput: parseListSymbolsInput,
    async execute(input, { signal }): Promise<ToolExecutionOutput<IdeSymbolsResultDto>> {
      signal.throwIfAborted();

      let value: unknown;
      try {
        value = await port.listSymbols(input, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof LanguageServiceUnavailableError) {
          throw new ToolExecutionError("failed", error.message);
        }
        if (error instanceof InvalidLanguageServiceOutputError) {
          throw new ToolExecutionError("invalid-output", error.message);
        }
        throw error;
      }

      signal.throwIfAborted();
      const result = ideSymbolsResultSchema.safeParse(value);
      if (!result.success) {
        throw new ToolExecutionError("invalid-output", "Language service returned invalid output.");
      }

      return { output: result.data, truncated: result.data.truncated };
    },
  };
}

export const languageLocationInputSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Workspace-relative text document path.",
      minLength: 1,
      maxLength: 4_096,
      pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$)).+$",
    },
    position: {
      type: "object",
      description: "Zero-based VS Code UTF-16 document position.",
      properties: {
        line: {
          type: "integer",
          description: "Zero-based document line.",
          minimum: 0,
          maximum: maxIdePositionLine,
        },
        character: {
          type: "integer",
          description: "Zero-based UTF-16 code-unit offset.",
          minimum: 0,
          maximum: maxIdePositionCharacter,
        },
      },
      required: ["line", "character"],
      additionalProperties: false,
    },
  },
  required: ["path", "position"],
  additionalProperties: false,
} as const;

export const listSymbolsInputSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Workspace-relative text document path.",
      minLength: 1,
      maxLength: 4_096,
      pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$)).+$",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

export function parseLanguageServiceInput(value: unknown): LanguageServiceInput {
  if (!isRecord(value)) {
    throw new TypeError("Expected language service input to be an object.");
  }
  if (!hasOnlyKeys(value, new Set(["path", "position"]))) {
    throw new TypeError("Unexpected language service input field.");
  }
  const path = parsePath(value.path);
  if (!isRecord(value.position) || !hasOnlyKeys(value.position, new Set(["line", "character"]))) {
    throw new TypeError("Invalid language service position.");
  }
  const position = parsePosition(value.position);
  return { path, position };
}

export function parseListSymbolsInput(value: unknown): ListSymbolsInput {
  if (!isRecord(value)) {
    throw new TypeError("Expected list_symbols input to be an object.");
  }
  if (!hasOnlyKeys(value, new Set(["path"]))) {
    throw new TypeError("Unexpected list_symbols input field.");
  }
  return { path: parsePath(value.path) };
}

function parsePath(value: unknown): string {
  if (
    !isSafeForwardSlashPath(value, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) ||
    !isCanonicalPath(value)
  ) {
    throw new TypeError("Invalid language service workspace path.");
  }
  return value;
}

function isCanonicalPath(value: string): boolean {
  if (!value.isWellFormed()) return false;
  if (value.split("/").some((segment) => segment.length === 0)) return false;
  if (value.includes("?") || value.includes("#") || /%(?:2e|2f|5c)/iu.test(value)) {
    return false;
  }
  if ([...value].length > maxIdeUriPathCodePoints) return false;
  return utf8ByteLength(value) <= maxIdeUriPathBytes;
}

function parsePosition(value: Record<string, unknown>): IdePositionDto {
  if (
    typeof value.line !== "number" ||
    !Number.isSafeInteger(value.line) ||
    value.line < 0 ||
    value.line > maxIdePositionLine ||
    typeof value.character !== "number" ||
    !Number.isSafeInteger(value.character) ||
    value.character < 0 ||
    value.character > maxIdePositionCharacter
  ) {
    throw new TypeError("Invalid language service position.");
  }
  return { line: value.line, character: value.character };
}
