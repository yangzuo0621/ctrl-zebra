import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";
import { z } from "zod";

import { decodeBoundedUtf8Prefix, parseBoundedBytes } from "./boundary-validation.js";
import { workspaceRelativePathSchema } from "./workspace-path-schema.js";
import { toToolInputSchema } from "./zod-tool-schema.js";

export const readFileToolName = "read_file" as const;
export const readFileToolDescription =
  "Read a bounded UTF-8 text range from a file in the selected workspace.";

const readFileZodSchema = z
  .strictObject({
    path: workspaceRelativePathSchema("Workspace-relative file path using forward slashes."),
    startLine: z
      .number()
      .int()
      .min(1)
      .describe("One-based first line to read. Defaults to 1.")
      .optional(),
    endLine: z.number().int().min(1).describe("Optional one-based inclusive last line.").optional(),
  })
  .refine((value) => value.endLine === undefined || value.endLine >= (value.startLine ?? 1), {
    message: "endLine must not be before startLine.",
    path: ["endLine"],
  });
export const readFileInputSchema = toToolInputSchema(readFileZodSchema);
export const maxReadFileContentBytes = 65_536;
export const readFileUtf8LookaheadBytes = 4;

export interface ReadFileInput {
  readonly path: string;
  readonly startLine: number;
  readonly endLine?: number;
}

export interface ReadFileOutput {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
}

export interface ReadFileRequest {
  readonly path: string;
  readonly maxBytes: number;
}

export interface ReadFileBytes {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

export interface ReadFileWorkspace {
  readFile(request: ReadFileRequest, signal: AbortSignal): Promise<unknown>;
}

export class BinaryFileError extends Error {
  constructor() {
    super("read_file supports UTF-8 text files only.");
    this.name = "BinaryFileError";
  }
}

export class ReadFileRangeError extends Error {
  constructor() {
    super("Requested read_file line range is outside the available text.");
    this.name = "ReadFileRangeError";
  }
}

export class InvalidWorkspaceFileReadError extends Error {
  constructor() {
    super("Workspace file reader returned invalid data.");
    this.name = "InvalidWorkspaceFileReadError";
  }
}

export function createReadFileTool(
  workspace: ReadFileWorkspace,
): AgentTool<ReadFileInput, ReadFileOutput> {
  return {
    name: readFileToolName,
    description: readFileToolDescription,
    inputSchema: readFileInputSchema,
    risk: "read",
    parseInput: parseReadFileInput,
    async execute(input, { signal }): Promise<ToolExecutionOutput<ReadFileOutput>> {
      signal.throwIfAborted();
      const value = await workspace.readFile(
        {
          path: input.path,
          maxBytes: maxReadFileContentBytes + readFileUtf8LookaheadBytes,
        },
        signal,
      );
      signal.throwIfAborted();
      const source = parseReadFileBytes(value);
      const decoded = decodeUtf8Prefix(source);
      const range = selectLineRange(decoded.text, input);

      return {
        output: {
          path: input.path,
          startLine: range.startLine,
          endLine: range.endLine,
          content: range.content,
        },
        truncated:
          decoded.truncated &&
          (input.endLine === undefined || input.endLine >= range.availableLines),
      };
    },
  };
}

function parseReadFileInput(value: unknown): ReadFileInput {
  const parsed = readFileZodSchema.parse(value);
  return { path: parsed.path, startLine: parsed.startLine ?? 1, endLine: parsed.endLine };
}

function parseReadFileBytes(value: unknown): ReadFileBytes {
  return parseBoundedBytes(value, () => new InvalidWorkspaceFileReadError(), {
    allowAdditionalProperties: false,
  });
}

function decodeUtf8Prefix(source: ReadFileBytes): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const decoded = decodeBoundedUtf8Prefix(source, maxReadFileContentBytes);
  if (decoded === undefined) {
    throw new BinaryFileError();
  }

  return decoded;
}

function selectLineRange(
  text: string,
  input: ReadFileInput,
): {
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly availableLines: number;
} {
  if (text.length === 0) {
    if (input.startLine !== 1 || (input.endLine !== undefined && input.endLine !== 1)) {
      throw new ReadFileRangeError();
    }

    return { startLine: 1, endLine: 0, content: "", availableLines: 0 };
  }

  const lines = text.split(/\r\n|\n|\r/u);
  if (input.startLine > lines.length) {
    throw new ReadFileRangeError();
  }

  const endLine = Math.min(input.endLine ?? lines.length, lines.length);
  return {
    startLine: input.startLine,
    endLine,
    content: lines.slice(input.startLine - 1, endLine).join("\n"),
    availableLines: lines.length,
  };
}
