import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";

export const readFileToolName = "read_file" as const;
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

  const allowedKeys = new Set(["path", "startLine", "endLine"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("Unexpected read_file input field.");
  }

  const path = value.path;
  const startLine = value.startLine ?? 1;
  const endLine = value.endLine;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 4_096 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(path)
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
  if (
    !isRecord(value) ||
    !(value.bytes instanceof Uint8Array) ||
    typeof value.truncated !== "boolean" ||
    Object.keys(value).some((key) => key !== "bytes" && key !== "truncated")
  ) {
    throw new InvalidWorkspaceFileReadError();
  }

  return { bytes: value.bytes, truncated: value.truncated };
}

function decodeUtf8Prefix(source: ReadFileBytes): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const exceedsContentLimit = source.bytes.byteLength > maxReadFileContentBytes;
  const candidate = source.bytes.subarray(0, maxReadFileContentBytes);
  if (candidate.includes(0)) {
    throw new BinaryFileError();
  }

  const mayEndMidCharacter = source.truncated || exceedsContentLimit;
  const maxTrim = mayEndMidCharacter ? Math.min(3, candidate.byteLength) : 0;
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        candidate.subarray(0, candidate.byteLength - trim),
      );
      return { text, truncated: mayEndMidCharacter || trim > 0 };
    } catch {
      // Only an incomplete UTF-8 suffix may be removed from an already truncated prefix.
    }
  }

  throw new BinaryFileError();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
