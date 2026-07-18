import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";

import {
  decodeBoundedUtf8Prefix,
  hasOnlyKeys,
  isRecord,
  isSafeForwardSlashPath,
  parseBoundedBytes,
} from "./boundary-validation.js";

export const readFileToolName = "read_file" as const;
export const readFileToolDescription =
  "Read a bounded UTF-8 text range from a file in the selected workspace.";
export const readFileInputSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Workspace-relative file path using forward slashes.",
      minLength: 1,
      maxLength: 4_096,
      pattern: "^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\).+$",
    },
    startLine: {
      type: "integer",
      description: "One-based first line to read. Defaults to 1.",
      minimum: 1,
    },
    endLine: {
      type: "integer",
      description: "Optional one-based inclusive last line.",
      minimum: 1,
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;
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
  if (!isRecord(value)) {
    throw new TypeError("Expected read_file input to be an object.");
  }

  if (!hasOnlyKeys(value, new Set(["path", "startLine", "endLine"]))) {
    throw new TypeError("Unexpected read_file input field.");
  }

  const path = value.path;
  const startLine = value.startLine ?? 1;
  const endLine = value.endLine;
  if (
    !isSafeForwardSlashPath(path, {
      maxLength: 4_096,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    })
  ) {
    throw new TypeError("Invalid read_file path.");
  }

  if (!isPositiveLineNumber(startLine)) {
    throw new TypeError("Invalid read_file startLine.");
  }

  if (endLine !== undefined && (!isPositiveLineNumber(endLine) || endLine < startLine)) {
    throw new TypeError("Invalid read_file endLine.");
  }

  return { path, startLine, endLine };
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

function isPositiveLineNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
