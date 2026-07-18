import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";

import {
  type ListFilesRequest,
  type ListFilesWorkspace,
  listFilesExcludeGlob,
} from "./list-files.js";
import type { ReadFileBytes, ReadFileRequest, ReadFileWorkspace } from "./read-file.js";

export const searchFilesToolName = "search_files" as const;
export const searchFilesToolDescription =
  "Search bounded UTF-8 workspace text and return matching file locations.";
export const searchFilesInputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Exact text to search for.",
      minLength: 1,
      maxLength: 256,
    },
    glob: {
      type: "string",
      description: "Workspace-relative glob pattern. Defaults to **/*.",
      minLength: 1,
      maxLength: 256,
      pattern: "^(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$",
    },
    maxResults: {
      type: "integer",
      description: "Maximum number of matches to return. Defaults to 100.",
      minimum: 1,
      maximum: 200,
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;
export const defaultSearchFilesLimit = 100;
export const maxSearchFilesLimit = 200;
export const maxSearchFilesScanned = 1_000;
export const maxSearchFileBytes = 262_144;
export const maxSearchPreviewCharacters = 240;

export interface SearchFilesInput {
  readonly query: string;
  readonly glob: string;
  readonly maxResults: number;
}

export interface SearchFileMatch {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
}

export interface SearchFilesOutput {
  readonly matches: readonly SearchFileMatch[];
}

export interface SearchFilesWorkspace extends ListFilesWorkspace, ReadFileWorkspace {}

export class InvalidWorkspaceSearchDataError extends Error {
  constructor() {
    super("Workspace search adapter returned invalid data.");
    this.name = "InvalidWorkspaceSearchDataError";
  }
}

export function createSearchFilesTool(
  workspace: SearchFilesWorkspace,
): AgentTool<SearchFilesInput, SearchFilesOutput> {
  return {
    name: searchFilesToolName,
    description: searchFilesToolDescription,
    inputSchema: searchFilesInputSchema,
    risk: "read",
    parseInput: parseSearchFilesInput,
    async execute(input, { signal }): Promise<ToolExecutionOutput<SearchFilesOutput>> {
      signal.throwIfAborted();
      const listed = await workspace.findFiles(createListRequest(input), signal);
      signal.throwIfAborted();
      const allFiles = parseFilePaths(listed);
      const files = allFiles.slice(0, maxSearchFilesScanned);
      let truncated = allFiles.length > files.length;
      const matches: SearchFileMatch[] = [];

      for (const path of files) {
        signal.throwIfAborted();
        const value = await workspace.readFile(createReadRequest(path), signal);
        signal.throwIfAborted();
        const source = parseReadBytes(value);
        const decoded = decodeSearchText(source);
        if (decoded === undefined) {
          continue;
        }

        truncated ||= decoded.truncated;
        collectMatches(matches, path, decoded.text, input.query, input.maxResults + 1);
        if (matches.length > input.maxResults) {
          return {
            output: { matches: matches.slice(0, input.maxResults) },
            truncated: true,
          };
        }
      }

      return { output: { matches }, truncated };
    },
  };
}

function parseSearchFilesInput(value: unknown): SearchFilesInput {
  if (!isRecord(value)) {
    throw new TypeError("Expected search_files input to be an object.");
  }

  const allowedKeys = new Set(["query", "glob", "maxResults"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("Unexpected search_files input field.");
  }

  const query = value.query;
  const glob = value.glob ?? "**/*";
  const maxResults = value.maxResults ?? defaultSearchFilesLimit;
  if (
    typeof query !== "string" ||
    query.length === 0 ||
    query.length > 256 ||
    query.includes("\0")
  ) {
    throw new TypeError("Invalid search_files query.");
  }

  if (
    typeof glob !== "string" ||
    glob.length === 0 ||
    glob.length > 256 ||
    glob.includes("\\") ||
    /(?:^|\/)\.\.(?:\/|$)/u.test(glob)
  ) {
    throw new TypeError("Invalid search_files glob.");
  }

  if (
    typeof maxResults !== "number" ||
    !Number.isSafeInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > maxSearchFilesLimit
  ) {
    throw new TypeError("Invalid search_files maxResults.");
  }

  return { query, glob, maxResults };
}

function createListRequest(input: SearchFilesInput): ListFilesRequest {
  return {
    glob: input.glob,
    excludeGlob: listFilesExcludeGlob,
    maxResults: maxSearchFilesScanned + 1,
  };
}

function createReadRequest(path: string): ReadFileRequest {
  return { path, maxBytes: maxSearchFileBytes + 4 };
}

function parseFilePaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvalidWorkspaceSearchDataError();
  }

  const paths = value.map((path) => {
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.length > 4_096 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      /(?:^|\/)\.{1,2}(?:\/|$)/u.test(path)
    ) {
      throw new InvalidWorkspaceSearchDataError();
    }

    return path;
  });

  return [...new Set(paths)].sort((left, right) => left.localeCompare(right, "en-US"));
}

function parseReadBytes(value: unknown): ReadFileBytes {
  if (
    !isRecord(value) ||
    !(value.bytes instanceof Uint8Array) ||
    typeof value.truncated !== "boolean"
  ) {
    throw new InvalidWorkspaceSearchDataError();
  }

  return { bytes: value.bytes, truncated: value.truncated };
}

function decodeSearchText(
  source: ReadFileBytes,
): { readonly text: string; readonly truncated: boolean } | undefined {
  const exceedsLimit = source.bytes.byteLength > maxSearchFileBytes;
  const candidate = source.bytes.subarray(0, maxSearchFileBytes);
  if (candidate.includes(0)) {
    return undefined;
  }

  const truncated = source.truncated || exceedsLimit;
  const maxTrim = truncated ? Math.min(3, candidate.byteLength) : 0;
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          candidate.subarray(0, candidate.byteLength - trim),
        ),
        truncated: truncated || trim > 0,
      };
    } catch {
      // Binary or invalid UTF-8 files are excluded from workspace text search.
    }
  }

  return undefined;
}

function collectMatches(
  matches: SearchFileMatch[],
  path: string,
  text: string,
  query: string,
  limit: number,
): void {
  const lines = text.split(/\r\n|\n|\r/u);
  for (let lineIndex = 0; lineIndex < lines.length && matches.length < limit; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    let fromIndex = 0;

    while (matches.length < limit) {
      const columnIndex = line.indexOf(query, fromIndex);
      if (columnIndex < 0) {
        break;
      }

      matches.push({
        path,
        line: lineIndex + 1,
        column: columnIndex + 1,
        preview: createPreview(line, columnIndex),
      });
      fromIndex = columnIndex + query.length;
    }
  }
}

function createPreview(line: string, columnIndex: number): string {
  const start = Math.max(0, columnIndex - Math.floor(maxSearchPreviewCharacters / 3));
  return line.slice(start, start + maxSearchPreviewCharacters);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
