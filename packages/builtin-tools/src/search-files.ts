import { type AgentTool, ToolExecutionError, type ToolExecutionOutput } from "@ctrl-zebra/core";

import { RE2JS } from "re2js";

import {
  decodeBoundedUtf8Prefix,
  hasOnlyKeys,
  isRecord,
  isSafeForwardSlashPath,
  parseBoundedBytes,
  parseWorkspaceFilePaths,
} from "./boundary-validation.js";
import {
  type ListFilesRequest,
  type ListFilesWorkspace,
  listFilesExcludeGlob,
} from "./list-files.js";
import type { ReadFileBytes, ReadFileRequest, ReadFileWorkspace } from "./read-file.js";
import { utf8ByteLength } from "./text-primitives.js";

export const searchFilesToolName = "search_files" as const;
export const searchFilesToolDescription =
  "Search bounded UTF-8 workspace text literally or with a controlled RE2-compatible pattern and return matching file locations.";
export const searchFilesModes = ["literal", "regex"] as const;
export type SearchFilesMode = (typeof searchFilesModes)[number];
export const searchFilesInputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Text or RE2-compatible pattern to search for.",
      minLength: 1,
      maxLength: 256,
    },
    mode: {
      type: "string",
      description: "Search mode. Defaults to literal.",
      enum: searchFilesModes,
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
export const maxSearchQueryScalars = 256;
export const maxSearchQueryBytes = 1_024;
export const maxSearchFileScalars = 65_536;
export const maxSearchRegexPerFileComplexity = 16_777_216;
export const maxSearchRegexAggregateComplexity = 67_108_864;
export const searchRegexLimitErrorMessage = "Regex search exceeds the configured complexity limit.";

export interface SearchFilesInput {
  readonly query: string;
  readonly glob: string;
  readonly maxResults: number;
  readonly mode?: SearchFilesMode;
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

interface ControlledRegex {
  readonly programSize: number;
  matcher(text: string): RegexMatcher;
}

interface RegexMatcher {
  find(): boolean;
  start(): number;
  end(): number;
}

const parsedRegexByInput = new WeakMap<object, ControlledRegex>();

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
      const mode = input.mode ?? "literal";
      const regex =
        mode === "regex"
          ? (parsedRegexByInput.get(input) ?? compileControlledRegex(input.query))
          : undefined;
      let aggregateComplexity = 0;
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
        if (regex === undefined) {
          collectMatches(matches, path, decoded.text, input.query, input.maxResults + 1);
        } else {
          const bounded = boundRegexText(decoded.text, signal);
          truncated ||= bounded.truncated;
          aggregateComplexity = assertRegexComplexity(
            regex.programSize,
            bounded.scalarCount,
            aggregateComplexity,
          );
          await collectRegexMatches(
            matches,
            path,
            bounded.text,
            regex,
            input.maxResults + 1,
            signal,
          );
        }
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

  if (!hasOnlyKeys(value, new Set(["query", "glob", "maxResults", "mode"]))) {
    throw new TypeError("Unexpected search_files input field.");
  }

  const query = value.query;
  const glob = value.glob ?? "**/*";
  const maxResults = value.maxResults ?? defaultSearchFilesLimit;
  const modeValue = value.mode;
  const mode = modeValue === undefined ? "literal" : modeValue;
  if (
    typeof query !== "string" ||
    query.length === 0 ||
    !isWellFormedUnicode(query) ||
    [...query].length > maxSearchQueryScalars ||
    utf8ByteLength(query) > maxSearchQueryBytes ||
    query.includes("\0")
  ) {
    throw new TypeError("Invalid search_files query.");
  }

  if (mode !== "literal" && mode !== "regex") {
    throw new TypeError("Invalid search_files mode.");
  }

  if (
    !isSafeForwardSlashPath(glob, {
      maxLength: 256,
      allowLeadingSlash: true,
      rejectCurrentSegments: false,
    })
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

  const parsed = { query, glob, maxResults, mode } satisfies SearchFilesInput;
  if (mode === "regex") {
    parsedRegexByInput.set(parsed, compileControlledRegex(query));
  }
  return parsed;
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
  return parseWorkspaceFilePaths(value, () => new InvalidWorkspaceSearchDataError());
}

function parseReadBytes(value: unknown): ReadFileBytes {
  return parseBoundedBytes(value, () => new InvalidWorkspaceSearchDataError(), {
    allowAdditionalProperties: true,
  });
}

function decodeSearchText(
  source: ReadFileBytes,
): { readonly text: string; readonly truncated: boolean } | undefined {
  return decodeBoundedUtf8Prefix(source, maxSearchFileBytes);
}

function compileControlledRegex(pattern: string): ControlledRegex {
  if (!isSupportedRegexDialect(pattern)) {
    throw new TypeError("Invalid search_files regex.");
  }

  try {
    const compiled = RE2JS.compile(pattern);
    const programSize = compiled.programSize();
    if (!Number.isSafeInteger(programSize) || programSize < 1) {
      throw new TypeError("Invalid search_files regex.");
    }

    return {
      programSize,
      matcher(text) {
        return compiled.matcher(text);
      },
    };
  } catch {
    throw new TypeError("Invalid search_files regex.");
  }
}

function isSupportedRegexDialect(pattern: string): boolean {
  let quoted = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (quoted) {
      if (character === "\\" && pattern[index + 1] === "E") {
        quoted = false;
        index += 1;
      }
      continue;
    }

    if (character === "\\") {
      const escaped = pattern[index + 1];
      if (escaped === undefined) {
        return false;
      }

      if (escaped === "Q") {
        quoted = true;
        index += 1;
        continue;
      }

      if (escaped === "C" || escaped === "E") {
        return false;
      }

      if (escaped === "0") {
        index += 1;
        if (/[0-7]/u.test(pattern[index + 1] ?? "")) {
          index += 1;
          if (/[0-7]/u.test(pattern[index + 1] ?? "")) {
            index += 1;
          }
        }
        continue;
      }

      if (/[1-7]/u.test(escaped)) {
        const next = pattern[index + 2];
        if (next === undefined || !/[0-7]/u.test(next)) {
          return false;
        }
        index += 2;
        if (/[0-7]/u.test(pattern[index + 1] ?? "")) {
          index += 1;
        }
        continue;
      }
      if (escaped === "8" || escaped === "9") {
        return false;
      }

      if (escaped === "x") {
        if (pattern[index + 2] === "{") {
          const closing = pattern.indexOf("}", index + 3);
          if (closing < 0 || closing === index + 3) {
            return false;
          }
          const codePoint = pattern.slice(index + 3, closing);
          if (!/^[0-9a-f]{1,6}$/iu.test(codePoint) || Number.parseInt(codePoint, 16) > 0x10ffff) {
            return false;
          }
          index = closing;
          continue;
        }
        if (!/^[0-9a-f]{2}$/iu.test(pattern.slice(index + 2, index + 4))) {
          return false;
        }
        index += 3;
        continue;
      }

      if (escaped === "p" || escaped === "P") {
        if (pattern[index + 2] === "{") {
          const closing = pattern.indexOf("}", index + 3);
          if (closing < 0 || closing === index + 3) {
            return false;
          }
          index = closing;
        } else if (pattern[index + 2] !== undefined) {
          index += 2;
        } else {
          return false;
        }
        continue;
      }

      if (
        ["a", "f", "t", "n", "r", "v", "d", "D", "s", "S", "w", "W", "A", "z", "b", "B"].includes(
          escaped,
        )
      ) {
        index += 1;
        continue;
      }

      if (!isRegexPunctuation(escaped)) {
        return false;
      }
      index += 1;
      continue;
    }

    if (character === "(" && pattern[index + 1] === "?") {
      const marker = pattern[index + 2];
      if (marker === ":") {
        index += 2;
        continue;
      }
      if (marker === "P" && pattern[index + 3] === "<") {
        index += 3;
        continue;
      }
      if (marker === "<" && pattern[index + 3] !== "=" && pattern[index + 3] !== "!") {
        index += 3;
        continue;
      }
      return false;
    }

    if (
      (character === "*" || character === "+" || character === "?") &&
      pattern[index + 1] === "+"
    ) {
      return false;
    }
    if (character === "}" && pattern[index + 1] === "+") {
      const opening = pattern.lastIndexOf("{", index);
      const quantifier = pattern.slice(opening + 1, index);
      if (
        opening >= 0 &&
        (opening === 0 || pattern[opening - 1] !== "\\") &&
        /^\d+(?:,\d*)?$/u.test(quantifier)
      ) {
        return false;
      }
    }
  }

  return true;
}

function isRegexPunctuation(value: string): boolean {
  return /^[\x20-/\x3a-\x40\x5b-\x60\x7b-\x7e]$/u.test(value);
}

function boundRegexText(
  text: string,
  signal: AbortSignal,
): { readonly text: string; readonly scalarCount: number; readonly truncated: boolean } {
  let scalarCount = 0;
  let end = 0;
  for (const scalar of text) {
    scalarCount += 1;
    end += scalar.length;
    if ((scalarCount & 4_095) === 0) {
      signal.throwIfAborted();
    }
    if (scalarCount === maxSearchFileScalars) {
      return {
        text: text.slice(0, end),
        scalarCount,
        truncated: end < text.length,
      };
    }
  }
  return { text, scalarCount, truncated: false };
}

function assertRegexComplexity(
  programSize: number,
  scalarCount: number,
  aggregate: number,
): number {
  const units = programSize * Math.max(1, scalarCount);
  if (
    !Number.isSafeInteger(units) ||
    units > maxSearchRegexPerFileComplexity ||
    aggregate > maxSearchRegexAggregateComplexity - units
  ) {
    throw new ToolExecutionError("invalid-input", searchRegexLimitErrorMessage);
  }
  return aggregate + units;
}

async function collectRegexMatches(
  matches: SearchFileMatch[],
  path: string,
  text: string,
  regex: ControlledRegex,
  limit: number,
  signal: AbortSignal,
): Promise<void> {
  const lines = splitSearchLines(text, signal);
  const matcher = regex.matcher(text);
  let lineIndex = 0;

  while (matches.length < limit && matcher.find()) {
    signal.throwIfAborted();
    const start = matcher.start();
    if (start === matcher.end()) {
      continue;
    }
    while (lineIndex + 1 < lines.length && lines[lineIndex + 1]?.start <= start) {
      lineIndex += 1;
    }
    const line = lines[lineIndex] ?? { start: 0, end: text.length };
    const column = start - line.start + 1;
    matches.push({
      path,
      line: lineIndex + 1,
      column,
      preview: createPreview(text.slice(line.start, line.end), column - 1),
    });
    if ((matches.length & 31) === 0) {
      await Promise.resolve();
    }
  }
}

function splitSearchLines(
  text: string,
  signal: AbortSignal,
): readonly { readonly start: number; readonly end: number }[] {
  const lines: { start: number; end: number }[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if ((index & 4_095) === 0) {
      signal.throwIfAborted();
    }
    const character = text[index];
    if (character !== "\n" && character !== "\r") {
      continue;
    }
    lines.push({ start, end: index });
    if (character === "\r" && text[index + 1] === "\n") {
      index += 1;
    }
    start = index + 1;
  }
  lines.push({ start, end: text.length });
  return lines;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) {
      continue;
    }
    if (codeUnit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
    }
    return false;
  }
  return true;
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
