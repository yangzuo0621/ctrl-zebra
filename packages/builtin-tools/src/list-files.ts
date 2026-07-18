import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";

import {
  hasOnlyKeys,
  isRecord,
  isSafeForwardSlashPath,
  parseWorkspaceFilePaths,
} from "./boundary-validation.js";

export const listFilesToolName = "list_files" as const;
export const listFilesToolDescription =
  "List files in the selected workspace that match a glob pattern.";
export const listFilesInputSchema = {
  type: "object",
  properties: {
    glob: {
      type: "string",
      description: "Workspace-relative glob pattern. Defaults to **/*.",
      minLength: 1,
      maxLength: 256,
      pattern: "^(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$",
    },
    maxResults: {
      type: "integer",
      description: "Maximum number of files to return. Defaults to 100.",
      minimum: 1,
      maximum: 200,
    },
  },
  required: [],
  additionalProperties: false,
} as const;
export const defaultListFilesLimit = 100;
export const maxListFilesLimit = 200;
export const listFilesExcludeGlob = "**/{.git,node_modules,dist,build,coverage,.next,out}/**";

export interface ListFilesInput {
  readonly glob: string;
  readonly maxResults: number;
}

export interface ListFilesOutput {
  readonly files: readonly string[];
}

export interface ListFilesRequest {
  readonly glob: string;
  readonly excludeGlob: string;
  readonly maxResults: number;
}

export interface ListFilesWorkspace {
  findFiles(request: ListFilesRequest, signal: AbortSignal): Promise<unknown>;
}

export class InvalidWorkspaceFileListError extends Error {
  constructor() {
    super("Workspace file listing returned invalid paths.");
    this.name = "InvalidWorkspaceFileListError";
  }
}

export function createListFilesTool(
  workspace: ListFilesWorkspace,
): AgentTool<ListFilesInput, ListFilesOutput> {
  return {
    name: listFilesToolName,
    description: listFilesToolDescription,
    inputSchema: listFilesInputSchema,
    risk: "read",
    parseInput: parseListFilesInput,
    async execute(input, { signal }): Promise<ToolExecutionOutput<ListFilesOutput>> {
      signal.throwIfAborted();
      const value = await workspace.findFiles(
        {
          glob: input.glob,
          excludeGlob: listFilesExcludeGlob,
          maxResults: input.maxResults + 1,
        },
        signal,
      );
      signal.throwIfAborted();
      const files = parseWorkspaceFileList(value);
      const truncated = files.length > input.maxResults;

      return {
        output: { files: files.slice(0, input.maxResults) },
        truncated,
      };
    },
  };
}

function parseListFilesInput(value: unknown): ListFilesInput {
  if (!isRecord(value)) {
    throw new TypeError("Expected list_files input to be an object.");
  }

  if (!hasOnlyKeys(value, new Set(["glob", "maxResults"]))) {
    throw new TypeError("Unexpected list_files input field.");
  }

  const glob = value.glob ?? "**/*";
  const maxResults = value.maxResults ?? defaultListFilesLimit;
  if (
    !isSafeForwardSlashPath(glob, {
      maxLength: 256,
      allowLeadingSlash: true,
      rejectCurrentSegments: false,
    })
  ) {
    throw new TypeError("Invalid list_files glob.");
  }

  if (
    typeof maxResults !== "number" ||
    !Number.isSafeInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > maxListFilesLimit
  ) {
    throw new TypeError("Invalid list_files maxResults.");
  }

  return { glob, maxResults };
}

function parseWorkspaceFileList(value: unknown): readonly string[] {
  return parseWorkspaceFilePaths(value, () => new InvalidWorkspaceFileListError());
}
