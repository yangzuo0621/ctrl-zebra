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
import { z } from "zod";

import { workspaceRelativePathSchema } from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

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

// Reuses workspaceRelativePathSchema (allowLeadingSlash: false, rejectCurrentSegments: true --
// its defaults) for the pattern hint and character bound, then layers isCanonicalPath's stricter,
// IDE-specific checks (no empty segments, no query/fragment/percent-encoded traversal characters,
// its own code-point/byte bounds) on top via `.refine()`.
function languageServicePathSchema(description: string) {
  return workspaceRelativePathSchema(description).refine(isCanonicalPath, {
    message: "Invalid language service workspace path.",
  });
}

const positionSchema = z
  .strictObject({
    line: z.number().int().min(0).max(maxIdePositionLine).describe("Zero-based document line."),
    character: z
      .number()
      .int()
      .min(0)
      .max(maxIdePositionCharacter)
      .describe("Zero-based UTF-16 code-unit offset."),
  })
  .describe("Zero-based VS Code UTF-16 document position.");

const languageServiceInputZodSchema = z.strictObject({
  path: languageServicePathSchema("Workspace-relative text document path."),
  position: positionSchema,
});
export const languageLocationInputSchema = toToolInputSchema(languageServiceInputZodSchema);

const listSymbolsInputZodSchema = z.strictObject({
  path: languageServicePathSchema("Workspace-relative text document path."),
});
export const listSymbolsInputSchema = toToolInputSchema(listSymbolsInputZodSchema);

export function parseLanguageServiceInput(value: unknown): LanguageServiceInput {
  return languageServiceInputZodSchema.parse(value);
}

export function parseListSymbolsInput(value: unknown): ListSymbolsInput {
  return listSymbolsInputZodSchema.parse(value);
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
